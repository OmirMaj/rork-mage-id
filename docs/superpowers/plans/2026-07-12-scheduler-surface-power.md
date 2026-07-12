# Scheduler Phase 3 — Surface the Power — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface three already-built-but-hidden scheduler engines as legible UI — resource leveling ("Fix overloads"), CPM float ("can slip N days"), and the audit log — on the web/desktop Pro scheduler.

**Architecture:** All logic already exists as pure engines (`levelResources` in `utils/cpm.ts`, `CpmTaskResult` float fields, `utils/scheduleAudit.ts` load/group/diff helpers). This plan adds two small pure presentation helpers (+validators), three modal components mirroring `EarnedValuePanel`, and thin wiring in `app/schedule-pro.tsx` + `SchedulerMenuBar.tsx`. Leveling is applied through the existing undo-aware `commit`.

**Tech Stack:** React Native / Expo (web + iOS), TS strict, `bun`. `useThemedStyles` + `Colors`/`Type`/`Tokens` (anti-slop lint). No jest — pure fns via `scripts/validate-*.ts` in the `ship-check` `&&`-chain. **OTA-safe: JS-only, no native modules, `expo.version` 1.0.0.** CPM/offline-queue/persistence untouched. Desktop-gated (`width >= GRID_BREAKPOINT = 900`). Branch: `claude/scheduler-front-door`.

---

## Confirmed anchors (grep to refresh exact line numbers — they shift)

- `utils/cpm.ts`: `levelResources(ctx: LevelingContext)` at ~810; `runCpm(tasks, { levelResources: true })` sets `CpmResult.leveledStartDays` (~1006); `CpmTaskResult { es,ef,ls,lf,totalFloat,freeFloat,isCritical }` (~50); `CpmResult { perTask, projectFinish, criticalPath, conflicts, leveledStartDays? }` (~72).
- `app/schedule-pro.tsx`: `commit(producer)` (~566, skips same-ref); `rolledTasks`/`workingTasks`; `cpm` result in render; `showCpmAnalysis()` raw Alert (~1005) wired via `actions.onCriticalPath` (~1519); `handleDeleteTask`; `handleAddTasks` (~776, Phase 2); audit already written in `handleEdit` (~586: `buildAuditEntry` + `void appendAuditToAsyncStorage(project.id, entry)`); modals declared as `<X visible={showX} onClose=… />` near ~1612-1757; `project?.id` in scope.
- `components/schedule/SchedulerMenuBar.tsx`: `SchedulerActions` interface (the menu callback bag) + a "Track" group; actions rendered as menu items.
- `utils/scheduleAudit.ts`: `loadAuditFromAsyncStorage(projectId): Promise<ScheduleAuditEntry[]>`, `groupAuditByDay(entries): {day,entries}[]`, `summarizeTaskDiff(before,after): string`, `buildAuditEntry(partial)`, `appendAuditToAsyncStorage(projectId, entry)`. Key `tertiary_schedule_audit::<projectId>`.
- `components/schedule/EarnedValuePanel.tsx` — the Modal + ScrollView + `useThemedStyles` + X-close pattern to mirror. `types/index.ts:667` `ScheduleAuditEntry`.

**Task order:** 1 (pure helpers) → 2 (Fix overloads) → 3 (float panel) → 4 (audit viewer). Sequential (2-4 all touch `schedule-pro.tsx` + `SchedulerMenuBar.tsx`).

---

### Task 1: Pure helpers + validators

**Files:** Create `utils/levelingSummary.ts`, `utils/floatExplain.ts`, `scripts/validate-leveling-summary.ts`, `scripts/validate-float-explain.ts`; modify `package.json`.

- [ ] **Step 1: `scripts/validate-leveling-summary.ts`**
```ts
// scripts/validate-leveling-summary.ts — pure-fn validator for utils/levelingSummary.ts.
import { summarizeLeveling } from '../utils/levelingSummary';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
const T = (id: string, startDay: number): ScheduleTask => ({ id, title: id.toUpperCase(), startDay, durationDays: 2, dependencies: [] } as ScheduleTask);

const tasks = [T('a', 1), T('b', 3), T('c', 5)];
// b moves 3→6 (+3), c moves 5→5 (0, ignored), a moves 1→2 (+1).
const m = new Map<string, number>([['a', 2], ['b', 6], ['c', 5]]);
const s = summarizeLeveling(tasks, m);
eq('shiftedCount ignores zero-delta', s.shiftedCount, 2);
eq('maxShiftDays is the largest |delta|', s.maxShiftDays, 3);
eq('totalShiftDays sums |delta|', s.totalShiftDays, 4);
eq('shifts carry id+title+from+to+delta', s.shifts.find(x => x.id === 'b'), { id: 'b', title: 'B', fromDay: 3, toDay: 6, deltaDays: 3 });
eq('no entries → empty summary', summarizeLeveling(tasks, new Map()), { shiftedCount: 0, maxShiftDays: 0, totalShiftDays: 0, shifts: [] });
eq('a leveled map with only zero-deltas → empty', summarizeLeveling(tasks, new Map([['a', 1]])), { shiftedCount: 0, maxShiftDays: 0, totalShiftDays: 0, shifts: [] });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run → FAIL** (`bun run scripts/validate-leveling-summary.ts`, module missing).

- [ ] **Step 3: `utils/levelingSummary.ts`**
```ts
// utils/levelingSummary.ts — pure summary of a resource-leveling pass. No React, no I/O.
// Compares each task's current startDay to its leveled startDay (from
// cpm.leveledStartDays) and reports only the tasks that actually move.
import type { ScheduleTask } from '../types';

export interface LevelingShift { id: string; title: string; fromDay: number; toDay: number; deltaDays: number }
export interface LevelingSummary { shiftedCount: number; maxShiftDays: number; totalShiftDays: number; shifts: LevelingShift[] }

export function summarizeLeveling(prev: ScheduleTask[], leveled: Map<string, number>): LevelingSummary {
  const shifts: LevelingShift[] = [];
  let maxShiftDays = 0;
  let totalShiftDays = 0;
  for (const t of prev) {
    const toDay = leveled.get(t.id);
    if (toDay === undefined) continue;
    const delta = toDay - t.startDay;
    if (delta === 0) continue;
    const abs = Math.abs(delta);
    maxShiftDays = Math.max(maxShiftDays, abs);
    totalShiftDays += abs;
    shifts.push({ id: t.id, title: t.title, fromDay: t.startDay, toDay, deltaDays: delta });
  }
  return { shiftedCount: shifts.length, maxShiftDays, totalShiftDays, shifts };
}
```

- [ ] **Step 4: Run → `6 passed, 0 failed`.**

- [ ] **Step 5: `scripts/validate-float-explain.ts`**
```ts
// scripts/validate-float-explain.ts — pure-fn validator for utils/floatExplain.ts.
import { floatPhrase, buildCriticalPathExplanation } from '../utils/floatExplain';
import type { ScheduleTask } from '../types';
import type { CpmResult, CpmTaskResult } from '../utils/cpm';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
eq('float 0 → critical wording', floatPhrase(0), 'On the critical path — no slack');
eq('float -2 → critical wording', floatPhrase(-2), 'On the critical path — no slack');
eq('float 1 → singular day', floatPhrase(1), 'Can slip 1 day');
eq('float 3 → plural days', floatPhrase(3), 'Can slip 3 days');

const T = (id: string): ScheduleTask => ({ id, title: id.toUpperCase(), startDay: 1, durationDays: 2, dependencies: [] } as ScheduleTask);
const per = (id: string, totalFloat: number, isCritical: boolean): [string, CpmTaskResult] =>
  [id, { id, es: 1, ef: 2, ls: 1, lf: 2, totalFloat, freeFloat: totalFloat, isCritical }];
const cpm: CpmResult = {
  perTask: new Map<string, CpmTaskResult>([per('a', 0, true), per('b', 0, true), per('c', 4, false), per('d', 1, false)]),
  projectStart: 1, projectFinish: 10, criticalPath: ['a', 'b'], conflicts: [],
} as CpmResult;
const ex = buildCriticalPathExplanation(cpm, [T('a'), T('b'), T('c'), T('d')]);
eq('finishDay from cpm', ex.finishDay, 10);
eq('critical chain in criticalPath order', ex.criticalTitles.map(x => x.id), ['a', 'b']);
eq('slack excludes critical, sorted asc by canSlipDays', ex.slack.map(x => x.id), ['d', 'c']);
eq('slack canSlipDays from totalFloat', ex.slack.find(x => x.id === 'c')?.canSlipDays, 4);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 6: Run → FAIL.**

- [ ] **Step 7: `utils/floatExplain.ts`**
```ts
// utils/floatExplain.ts — pure plain-language explanation of CPM float. No React, no I/O.
import type { ScheduleTask } from '../types';
import type { CpmResult } from './cpm';

/** Plain-language slack phrase for a task's total float. */
export function floatPhrase(totalFloat: number): string {
  if (totalFloat <= 0) return 'On the critical path — no slack';
  return `Can slip ${totalFloat} ${totalFloat === 1 ? 'day' : 'days'}`;
}

export interface CriticalPathExplanation {
  finishDay: number;
  criticalTitles: { id: string; title: string }[];
  slack: { id: string; title: string; canSlipDays: number }[];
}

/** Build a plain-language explanation from an already-computed CPM result. */
export function buildCriticalPathExplanation(cpm: CpmResult, tasks: ScheduleTask[]): CriticalPathExplanation {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const criticalTitles = cpm.criticalPath
    .map(id => ({ id, title: byId.get(id)?.title ?? id }));
  const slack = tasks
    .map(t => ({ t, r: cpm.perTask.get(t.id) }))
    .filter(({ r }) => !!r && !r.isCritical && r.totalFloat > 0)
    .map(({ t, r }) => ({ id: t.id, title: t.title, canSlipDays: r!.totalFloat }))
    .sort((a, b) => a.canSlipDays - b.canSlipDays)
    .slice(0, 20);
  return { finishDay: cpm.projectFinish, criticalTitles, slack };
}
```

- [ ] **Step 8: Run → `8 passed, 0 failed`.**

- [ ] **Step 9: `package.json`** — after `"test:paste-rows"` add:
```json
    "test:leveling-summary": "bun run scripts/validate-leveling-summary.ts",
    "test:float-explain": "bun run scripts/validate-float-explain.ts",
```
and append ` && bun run test:leveling-summary && bun run test:float-explain` to `ship-check`.

- [ ] **Step 10: `npx tsc --noEmit` clean; commit**
```bash
git add utils/levelingSummary.ts utils/floatExplain.ts scripts/validate-leveling-summary.ts scripts/validate-float-explain.ts package.json
git commit -m "feat(scheduler): pure leveling-summary + float-explain helpers + validators"
```

---

### Task 2: Fix overloads (resource leveling) UI

**Files:** Create `components/schedule/LevelingPreviewModal.tsx`; modify `app/schedule-pro.tsx`, `components/schedule/SchedulerMenuBar.tsx`, `components/schedule/tabs/WorkloadTab.tsx`, `components/schedule/SchedulerTabShell.tsx`.

**Context:** `runCpm` + `levelResources` are pure and already imported/available via `@/utils/cpm`. `summarizeLeveling` from Task 1. Apply through `commit`. Mirror `EarnedValuePanel.tsx` for the modal.

- [ ] **Step 1: `LevelingPreviewModal.tsx`** — a Modal (`visible`, `summary: LevelingSummary`, `projectFinishDelta: number`, `onApply`, `onClose`) mirroring `EarnedValuePanel`'s structure (read that file first). Header "Fix overloads"; a one-line summary "{shiftedCount} task(s) shift · finish {+D days|unchanged} · biggest move {maxShiftDays}d"; a `ScrollView` list of `summary.shifts` (title, `fromDay → toDay`); footer with a secondary "Cancel" (`onClose`) and primary "Apply leveling" (`onApply`). Tokens only. Empty/zero case is handled by the caller (won't open the modal).

- [ ] **Step 2: `handleFixOverloads` in `schedule-pro.tsx`** (near `showCpmAnalysis`):
```tsx
const [levelingPreview, setLevelingPreview] = useState<{ summary: LevelingSummary; leveled: Map<string, number>; finishDelta: number } | null>(null);

const handleFixOverloads = useCallback(() => {
  const leveledResult = runCpm(rolledTasks, { levelResources: true });
  const leveled = leveledResult.leveledStartDays;
  if (!leveled || leveled.size === 0) {
    const msg = 'No overloads to resolve — every crew is within capacity.';
    if (Platform.OS === 'web') window.alert?.(msg); else Alert.alert('Fix overloads', msg);
    return;
  }
  const summary = summarizeLeveling(workingTasks, leveled);
  if (summary.shiftedCount === 0) {
    const msg = 'No overloads to resolve — every crew is within capacity.';
    if (Platform.OS === 'web') window.alert?.(msg); else Alert.alert('Fix overloads', msg);
    return;
  }
  setLevelingPreview({ summary, leveled, finishDelta: leveledResult.projectFinish - cpm.projectFinish });
}, [rolledTasks, workingTasks, cpm.projectFinish]);

const applyLeveling = useCallback(() => {
  const p = levelingPreview;
  if (!p) return;
  commit(prev => prev.map(t => p.leveled.has(t.id) ? { ...t, startDay: p.leveled.get(t.id)! } : t));
  if (project?.id) {
    void appendAuditToAsyncStorage(project.id, buildAuditEntry({
      user: user?.email ?? user?.name ?? 'anonymous',
      kind: 'reflow',
      summary: `Resource leveling: ${p.summary.shiftedCount} task(s) shifted`,
    }));
  }
  setLevelingPreview(null);
}, [levelingPreview, commit, project?.id, user?.email, user?.name]);
```
Render `<LevelingPreviewModal visible={levelingPreview !== null} summary={levelingPreview?.summary ?? EMPTY} projectFinishDelta={levelingPreview?.finishDelta ?? 0} onApply={applyLeveling} onClose={() => setLevelingPreview(null)} />` (define a stable `EMPTY` const summary or guard the render). Confirm `runCpm` is imported (it is — `cpm` is built from it in this file); import `summarizeLeveling` + `LevelingSummary` from `@/utils/levelingSummary`.

- [ ] **Step 3: Menu action** — in `SchedulerMenuBar.tsx` add `onLevelResources?: () => void` to `SchedulerActions`, and a "Fix overloads" item in the **Track** group calling it. In `schedule-pro.tsx`'s `actions={{…}}` add `onLevelResources: handleFixOverloads`.

- [ ] **Step 4: Contextual WorkloadTab button** — add an optional `onFixOverloads?: () => void` prop to `WorkloadTab`. When the computed load matrix has any over-capacity cell (reuse the existing over-capacity detection), render a small "Fix overloads" button (tokens only) that calls `onFixOverloads`. Thread `onFixOverloads` from `schedule-pro` → `SchedulerTabShell` → `WorkloadTab` the same way other tab callbacks/ render-props flow (grep how WorkloadTab is currently rendered and mirror it).

- [ ] **Step 5: Verify + commit** — `npx tsc --noEmit` clean; `bun run lint` 0 errors, no new warnings.
```bash
git add components/schedule/LevelingPreviewModal.tsx app/schedule-pro.tsx components/schedule/SchedulerMenuBar.tsx components/schedule/tabs/WorkloadTab.tsx components/schedule/SchedulerTabShell.tsx
git commit -m "feat(scheduler): Fix overloads — run + preview + apply resource leveling (undoable)"
```

---

### Task 3: Explained critical-path / float panel

**Files:** Create `components/schedule/CriticalPathPanel.tsx`; modify `app/schedule-pro.tsx`.

**Context:** `buildCriticalPathExplanation(cpm, tasks)` + `floatPhrase` from Task 1. Current entry point is `showCpmAnalysis` (raw Alert) wired to `actions.onCriticalPath`. Mirror `EarnedValuePanel`.

- [ ] **Step 1: `CriticalPathPanel.tsx`** — Modal (`visible`, `explanation: CriticalPathExplanation`, `onClose`) mirroring `EarnedValuePanel`. Header "What's driving the finish date"; a line "Projected finish: day {finishDay}"; section "The critical path" rendering `criticalTitles` as an ordered chain (Title → Title → …, wrap gracefully); section "These have breathing room" listing each `slack` item as "{title} — {floatPhrase(canSlipDays)}"; empty-slack line "Every task is on the critical path — no slack anywhere." Tokens only, `useThemedStyles`.

- [ ] **Step 2: Wire in `schedule-pro.tsx`** — add `const [showCriticalPath, setShowCriticalPath] = useState(false);`. Replace `showCpmAnalysis`'s body so it opens the panel instead of alerting:
```tsx
const showCpmAnalysis = useCallback(() => { setShowCriticalPath(true); }, []);
```
Render near the other modals:
```tsx
<CriticalPathPanel
  visible={showCriticalPath}
  explanation={buildCriticalPathExplanation(cpm, rolledTasks)}
  onClose={() => setShowCriticalPath(false)}
/>
```
Import `CriticalPathPanel` and `buildCriticalPathExplanation` from their modules. (Keep the `onCriticalPath: showCpmAnalysis` wiring — the menu item now opens the panel.)

- [ ] **Step 3: Verify + commit** — `npx tsc --noEmit` clean; `bun run lint` 0 errors.
```bash
git add components/schedule/CriticalPathPanel.tsx app/schedule-pro.tsx
git commit -m "feat(scheduler): explained critical-path / float panel replaces raw Alert"
```

---

### Task 4: Audit-log viewer + broaden writes

**Files:** Create `components/schedule/ScheduleAuditModal.tsx`; modify `app/schedule-pro.tsx`, `components/schedule/SchedulerMenuBar.tsx`.

**Context:** `loadAuditFromAsyncStorage(projectId)` / `groupAuditByDay` / `summarizeTaskDiff` from `@/utils/scheduleAudit`. Audit is already written on edits; add create + delete writes. Mirror `EarnedValuePanel`/`BaselineManagerModal`.

- [ ] **Step 1: `ScheduleAuditModal.tsx`** — Modal (`visible`, `projectId: string`, `onClose`). On `visible` transition to true, `loadAuditFromAsyncStorage(projectId)` into state (with a `loading` flag); `groupAuditByDay(entries)` → a `ScrollView` of day sections; each entry row: `HH:MM` (from `at`) · `user` · a `kind` chip · `summary`; if `before`/`after` present, a muted second line `summarizeTaskDiff(before, after)`. Empty state "No schedule history yet — edits you make will show up here." Loading state a spinner/"Loading…". Tokens only, `useThemedStyles`, `useSafeAreaInsets`. Use `useEffect([visible, projectId])` to (re)load on open.

- [ ] **Step 2: Broaden writes in `schedule-pro.tsx`** — add a small local helper and call it from `handleAddTasks` and `handleDeleteTask`:
```tsx
const writeAudit = useCallback((entry: Parameters<typeof buildAuditEntry>[0]) => {
  if (!project?.id) return;
  void appendAuditToAsyncStorage(project.id, buildAuditEntry(entry));
}, [project?.id]);
```
In `handleAddTasks`, after computing `newIds`, add:
```tsx
writeAudit({
  user: user?.email ?? user?.name ?? 'anonymous',
  kind: 'task_create',
  summary: partials.length === 1 ? `Added task "${partials[0].title || 'Untitled'}"` : `Added ${partials.length} tasks`,
});
```
In `handleDeleteTask`, before/after the delete, add (with the deleted task's title if available):
```tsx
writeAudit({ user: user?.email ?? user?.name ?? 'anonymous', kind: 'task_delete', taskId, summary: `Deleted task "${deletedTitle}"` });
```
(Grep `handleDeleteTask` to get the deleted task's title; if not readily available, look it up from `workingTasks.find(t => t.id === taskId)?.title` before the commit.)

- [ ] **Step 3: Menu action + render** — `SchedulerMenuBar.tsx`: add `onHistory?: () => void` to `SchedulerActions` and a "History" item in the **Track** group. `schedule-pro.tsx`: `const [showAudit, setShowAudit] = useState(false);`, `actions.onHistory: () => setShowAudit(true)`, and render `<ScheduleAuditModal visible={showAudit} projectId={project?.id ?? ''} onClose={() => setShowAudit(false)} />`.

- [ ] **Step 4: Verify + commit** — `npx tsc --noEmit` clean; `bun run lint` 0 errors; `bun run ship-check` green end-to-end (incl. the two new Task-1 validators).
```bash
git add components/schedule/ScheduleAuditModal.tsx app/schedule-pro.tsx components/schedule/SchedulerMenuBar.tsx
git commit -m "feat(scheduler): audit-log viewer + record task create/delete"
```

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `bun run lint` 0 errors, no new warnings in touched files.
- [ ] `bun run ship-check` green end-to-end (incl. `test:leveling-summary` 6, `test:float-explain` 8).
- [ ] **Owner visual review at merge (web ≥900px):** "Fix overloads" (menu + WorkloadTab) previews shifts then applies undoably; the critical-path panel reads in plain language ("can slip N days"); the History modal shows real edit history grouped by day; creating/deleting tasks now appears in it.

## Out of scope (deferred)
Per-day workload granularity; drag-to-reassign; what-if leveling scenarios; audit export/filtering.
