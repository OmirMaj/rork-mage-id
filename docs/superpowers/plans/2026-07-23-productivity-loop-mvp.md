# Productivity Feedback Loop ("Your Real Pace") MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the actuals→estimates loop for TIME the way the cost DB closed it for MONEY. Two parts, in dependency order: (1) **Capture** — as-built dates (`actualStartDay/actualEndDay/actualStartDate/actualEndDate`) get stamped automatically on every task status transition, because today only the Gantt's manual "Start today"/"Finish today" buttons set them (~5% coverage) and a learning engine over empty data is demo-ware; (2) **Learn + surface** — a pure `buildPaceBook` engine (the time-twin of `buildCostDatabase`) plus a tappable **PaceChip** on the schedule-review screen: *"Your pace: 9d (4 jobs)"* — one tap replaces the AI's guessed duration with the contractor's measured one. Ignorable, never automatic.

**Architecture:** Two pure modules under `utils/pace/`: `stampActuals(task, newStatus, todayDayNumber, nowISO): Partial<ScheduleTask>` (transition stamping; NEVER overwrites an existing actual — the Gantt's manual buttons stay authoritative) and `paceBook.ts` (`buildPaceBook`/`lookupPace`/`suggestDuration`, keyed `${trade}|${sqftBucket}` with a `${trade}|all` trade-wide fallback aggregate, blended with `w = jobCount/(jobCount+3)` exactly like the cost book). Capture wires into the **three real status-change sinks** (not per-widget): `handleEdit` in `app/schedule-pro.tsx` (which funnels GridPane, TaskInspector, and the Gantt bar menu), `onUpdateTask` in `components/schedule/mobile/MobileScheduleScreen.tsx` (which funnels TaskDetailSheet and MobileScheduleList), and the classic schedule's `handleSaveTask` + `handleProgressUpdate` in `app/(tabs)/schedule/index.tsx`. The chip lives on `app/schedule-review.tsx` task cards and applies through the screen's `setTasks` state — `accept()` already rebuilds via `buildScheduleFromTasks`, whose forward pass reflows dependent startDays.

**Tech Stack:** TypeScript (strict), React Native / Expo Router, bun. No jest — one pure-function validator (`scripts/validate-pace.ts`) chained into `ship-check` as `test:pace`. **Zero AI calls** — the whole feature is deterministic math over data the app already stores.

**Branch:** `claude/productivity-loop` (already checked out, off `main`).

**Ship boundary:** Everything here is OTA-safe: pure client TS/TSX. The actuals fields already exist on `ScheduleTask` (Phase 5) and already persist through `updateProject → project.schedule` — the exact path the Gantt's manual stamping uses today — so there is **no migration, no edge-fn change, no new AsyncStorage key** (nothing to add to `LOCAL_USER_CACHE_KEYS`), and the `punch_location` offline-queue trap does not apply. No tier gate: capture is invisible plumbing and the chip only appears when the user's own history supports it.

---

## File Structure

**Create (pure engine):**
- `utils/pace/stampActuals.ts` — `stampActuals`, `todayDayNumberFrom` (the shared "today's day number" basis).
- `utils/pace/paceBook.ts` — `PaceSample`, `PaceBookEntry`, `PaceBook`, `SqftBucket`, `PACE_BLEND_K`, `bucketForSqft`, `paceConfidence`, `buildPaceBook`, `lookupPace`, `suggestDuration`.

**Create (UI):**
- `components/schedule/PaceChip.tsx` — the tappable "Your pace" suggestion chip.

**Create (validator):**
- `scripts/validate-pace.ts` — both pace modules tested in this ONE file, built up across Tasks 1–2.

**Modify:**
- `app/schedule-pro.tsx` — merge `stampActuals` into `handleEdit` (Task 3).
- `components/schedule/mobile/MobileScheduleScreen.tsx` — merge into `onUpdateTask` (Task 3).
- `app/(tabs)/schedule/index.tsx` — merge into `handleSaveTask` + `handleProgressUpdate` (Task 3).
- `app/schedule-review.tsx` — pace book memo + PaceChip on task cards (Task 4).
- `package.json` — `"test:pace"` script chained into `ship-check` (Task 1).

**Reference (reuse, unchanged):** `utils/scheduleColors.ts` (`tradeKeyForTask`), `utils/costDatabase.ts` (the pattern being mirrored), `components/schedule/InteractiveGantt.tsx` (existing manual stamping — deliberately untouched), `types/index.ts` (all needed fields already exist — **no type changes in this feature**).

**Engine types live in `utils/pace/paceBook.ts`, not `types/index.ts`** — same precedent as `CostSample`/`CostBookEntry`/`CostDatabase` living in `utils/costDatabase.ts`: they are derived engine outputs, never persisted domain objects. `ScheduleTask` already carries every persisted field this feature touches.

---

## Grounded reality (verified in code, 2026-07-23)

These are REAL signatures/shapes from the repo. Do not re-derive them — build against these.

### 1. `TaskStatus` + `ScheduleTask` actuals (`types/index.ts:432, 456, 524-552`)

```ts
export type TaskStatus = 'not_started' | 'in_progress' | 'on_hold' | 'done';

export interface ScheduleTask {
  id: string;
  title: string;
  phase: string;
  durationDays: number;
  startDay: number;
  progress: number;
  // …
  status: TaskStatus;
  isMilestone?: boolean;
  // As-built tracking (Phase 5). These are OPTIONAL and read-only to the CPM
  // engine — they don't cascade to successors unless the user explicitly hits
  // "Reflow from actuals." The rule: the plan stays the plan until you say so.
  //   actualStartDay: day the task actually started (1-indexed, same basis as startDay)
  //   actualEndDay:   day the task actually finished (inclusive)
  //   actualStartDate / actualEndDate: absolute dates captured alongside the
  //     day numbers — useful for reporting and less fragile than recomputing
  //     from projectStartDate (which can shift if the user edits it).
  actualStartDay?: number;
  actualEndDay?: number;
  actualStartDate?: string;
  actualEndDate?: string;
  // …
  /** Trade taxonomy override. When unset, scheduleColors.inferTradeFromName(task.title)
   *  resolves the trade. Set via TaskInspector trade picker (Task 19). */
  tradeKey?: TradeKey;
}
```

### 2. `Project` + `ProjectSchedule` (`types/index.ts:130/152/182, 751-764`)

```ts
export interface Project {
  id: string;
  name: string;
  // …
  squareFootage: number;          // :152 — the size-bucket basis
  // …
  schedule?: ProjectSchedule | null;   // :182
}

export interface ProjectSchedule {
  id: string;
  name: string;
  projectId: string | null;
  /**
   * ISO date (YYYY-MM-DD) of Day 1 of the schedule. All task `startDay`
   * values are offsets from this date. Optional for back-compat — when
   * absent, consumers should fall back to today.
   */
  startDate?: string;
  workingDaysPerWeek: number;
  bufferDays: number;
  tasks: ScheduleTask[];
  // …
}
```

### 3. Trade identity (`types/index.ts:4-7`, `utils/scheduleColors.ts:44-55`)

```ts
export type TradeKey =
  | 'general' | 'concrete' | 'framing' | 'electrical' | 'plumbing'
  | 'hvac'    | 'roofing'  | 'steel'   | 'demo'       | 'landscaping'
  | 'finish'  | 'closeout';
```

```ts
export function inferTradeFromName(name: string | null | undefined): TradeKey {
  if (!name) return 'general';
  for (const [re, key] of INFERENCE_RULES) {
    if (re.test(name)) return key;
  }
  return 'general';
}

export function tradeKeyForTask(task: ScheduleTask): TradeKey {
  if (task.tradeKey) return task.tradeKey;
  return inferTradeFromName(task.title);
}
```

The inference is intentionally conservative (regex table at `:30-42` — e.g. `/plumb|pipe|drain/i → 'plumbing'`, `/frame|framing|stud/i → 'framing'`); false negatives fall to `'general'`. All `TradeKey` values are already lowercase — the pace-book keys need no extra normalization beyond `trim().toLowerCase()` on lookup (mirroring `lookupRate`).

### 4. The pattern being mirrored (`utils/costDatabase.ts:24-25, 174-180, 223-226`)

```ts
/** Blend constant: at n samples, personal weight = n/(n+K). K=3 ⇒ 50/50 at n=3. */
const BLEND_K = 3;
```

```ts
    const jobIds = new Set(ss.map(s => s.projectId));
    const n = jobIds.size;
    const w = n / (n + BLEND_K);
    const suggestedRate = baseline > 0 ? baseline * (1 - w) + personalRate * w : personalRate;

    const confidence: CostBookEntry['confidence'] =
      n >= 5 && variability <= 0.2 ? 'high' : n >= 3 ? 'medium' : 'low';
```

```ts
export function lookupRate(db: CostDatabase, trade: string, unit: string): CostBookEntry | null {
  const key = `${(trade || '').trim().toLowerCase()}|${(unit || 'unit').trim().toLowerCase()}`;
  return db.entries.find(e => e.key === key) ?? null;
}
```

The pace book mirrors: samples → per-key entries → `w = jobCount/(jobCount+3)` blend → confidence bands. **One deliberate divergence per the approved spec:** pace confidence uses `cv <= 0.35` for high (durations are noisier than unit prices), not the cost book's `0.2`.

### 5. The existing manual stamping the helper must mirror (`components/schedule/InteractiveGantt.tsx:616-638`)

```ts
  // --- Phase 5: as-built quick actions ------------------------------------
  const logStartToday = useCallback((task: ScheduleTask) => {
    const now = new Date();
    onEdit(task.id, {
      actualStartDay: todayDayNumber,
      actualStartDate: now.toISOString(),
      status: task.status === 'not_started' ? 'in_progress' : task.status,
    });
  }, [onEdit, todayDayNumber]);

  const logFinishToday = useCallback((task: ScheduleTask) => {
    const now = new Date();
    const patch: Partial<ScheduleTask> = {
      actualEndDay: todayDayNumber,
      actualEndDate: now.toISOString(),
      status: 'done',
      progress: 100,
    };
    if (task.actualStartDay == null) {
      patch.actualStartDay = task.startDay;
      patch.actualStartDate = now.toISOString();
    }
    onEdit(task.id, patch);
  }, [onEdit, todayDayNumber]);
```

**The retro-start rule to mirror:** finishing a task whose start was never logged back-fills `actualStartDay` from the PLANNED `task.startDay` (not today), with `actualStartDate = now`. These two buttons route through `onEdit → handleEdit` (Grounded reality #6a) — the wired helper must produce identical values there and must let this explicit patch win (no double-stamp, no divergent values).

**The `todayDayNumber` basis** (`InteractiveGantt.tsx:172-175, 278-282`):

```ts
function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
// …
  const todayDayNumber = useMemo(() => {
    const now = new Date();
    // "Day 1" is projectStartDate. So today = daysBetween + 1.
    return daysBetween(projectStartDate, now) + 1;
  }, [projectStartDate]);
```

where the `projectStartDate` prop comes from the host screen. `app/schedule-pro.tsx:479-491` builds it — and already exposes a clamped screen-level `todayDayNumber` that Task 3 reuses directly:

```ts
  const projectStartDate = useMemo(() => (
    project?.schedule?.startDate ? new Date(project.schedule.startDate + 'T00:00:00')
    : project?.createdAt ? new Date(project.createdAt)
    : new Date()
  ), [project?.schedule?.startDate, project?.createdAt]);

  const workingDaysPerWeek = project?.schedule?.workingDaysPerWeek ?? 5;

  const todayDayNumber = useMemo(() => {
    const ms = Date.now() - projectStartDate.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, days);
  }, [projectStartDate]);
```

So the canonical basis is: **`floor((now − scheduleStart@midnight) / 86 400 000) + 1`, clamped ≥ 1**. `todayDayNumberFrom` (Task 1) encodes exactly this for the sinks that don't already have the memo. (The classic screen's own `projectStartDate` memo at `app/(tabs)/schedule/index.tsx:233-241` anchors to `'T12:00:00'` — noon — which would compute day 0 on the morning of day 1; that is why Task 3's classic wiring calls `todayDayNumberFrom(activeSchedule?.startDate)` instead of deriving from that Date.)

### 6. THE STATUS-CHANGE SITE CENSUS — every place `status` is written on a schedule task

Found by grepping all `status:` writes on `ScheduleTask` across `app/`, `components/`, `utils/`. Three sinks cover every UI touchpoint; four call sites get edited in Task 3.

#### 6a. Desktop/web Pro sink — `app/schedule-pro.tsx:615-635` `handleEdit` (EDIT THIS)

```ts
  const handleEdit = useCallback((taskId: string, patch: Partial<ScheduleTask>) => {
    // Log to the audit before applying so we have the "before" snapshot.
    const before = workingTasks.find(t => t.id === taskId);
    if (before && project?.id) {
      const isLogicChange = 'dependencies' in patch || 'dependencyLinks' in patch;
      const isProgressChange = 'progress' in patch && patch.progress !== before.progress;
      const entry = buildAuditEntry({
        user: user?.email ?? user?.name ?? 'anonymous',
        taskId,
        taskTitle: before.title,
        kind: isLogicChange ? 'dependency_edit'
          : isProgressChange ? 'progress_update'
          : 'task_edit',
        summary: summarizeTaskDiff(before as unknown as Record<string, unknown>, { ...before, ...patch } as unknown as Record<string, unknown>),
        before: before as unknown as Record<string, unknown>,
        after: { ...before, ...patch } as unknown as Record<string, unknown>,
      });
      void appendAuditToAsyncStorage(project.id, entry);
    }
    commit(prev => prev.map(t => (t.id === taskId ? { ...t, ...patch } : t)));
  }, [commit, workingTasks, project?.id, user]);
```

Every desktop Pro surface funnels here via `onEdit={handleEdit}` (`schedule-pro.tsx:1692` → SchedulerTabShell → GridPane/InteractiveGantt/tabs; `:1724` → TaskInspector). Feeders that write `status` (all covered by ONE edit in this sink):

- `components/schedule/GridPane.tsx:1125` — grid status-cell chip, cycles through `nextStatus` (`:1849-1853`: `['not_started','in_progress','on_hold','done']`, wraps):
  ```tsx
  onPress={() => onEdit(task.id, { status: nextStatus(task.status) })}
  ```
- `components/schedule/GridPane.tsx:433` — row context menu:
  ```ts
  { key: 'done', label: 'Mark complete', onPress: () => onEdit(task.id, { status: 'done', progress: 100 }) },
  ```
- `components/schedule/GridPane.tsx:665-671` — progress-cell commit implies a status flip (patch built in `commitEdit`, lands in `onEdit(task.id, patch)`):
  ```ts
  patch.progress = Math.round(v);
  if (v >= 100 && task.status !== 'done') patch.status = 'done';
  else if (v > 0 && v < 100 && task.status === 'not_started') patch.status = 'in_progress';
  ```
- `components/schedule/TaskInspector.tsx:195` — inspector status chips (options from `STATUS_OPTIONS`, `:50`):
  ```tsx
  onPress={() => onEdit(task.id, { status: opt.value })}
  ```
- `components/schedule/InteractiveGantt.tsx:205` — bar context menu:
  ```ts
  { key: 'done', label: 'Mark complete', onPress: () => onEdit(task.id, { status: 'done', progress: 100 }) },
  ```
- `components/schedule/InteractiveGantt.tsx:616-638` — `logStartToday`/`logFinishToday` (quoted in #5). **Already stamp explicitly.** The sink merges the stamp UNDER the incoming patch (`{ ...stamp, ...patch }`), so these explicit values always win — and since `stampActuals` computes the same numbers for an unstamped task and returns `{}` for a stamped one, there is no double-stamp and no divergence. Gantt component untouched.

Today's-day access: the screen-level `todayDayNumber` memo (`:487-491`, quoted in #5) is in scope — reuse it (add to the callback's dep array).

#### 6b. Mobile Pro sink — `components/schedule/mobile/MobileScheduleScreen.tsx:96-99` `onUpdateTask` (EDIT THIS)

```ts
  const onUpdateTask = useCallback((next: ScheduleTask) => {
    saveTasks(tasks.map((t) => (t.id === next.id ? next : t)));
    setDetailTask(next);
  }, [tasks, saveTasks]);
```

This is a FULL-OBJECT sink (`next` is `{ ...task, status, … }`, so it carries the previous actuals through the spread). Feeders that write `status`:

- `components/schedule/mobile/TaskDetailSheet.tsx:89-98` — status segmented control + progress slider:
  ```ts
  const setStatus = (s: TaskStatus) => {
    haptic();
    const progress = s === 'done' ? 100 : s === 'not_started' ? 0 : (task.progress ?? 0);
    setPctDraft(progress);
    onUpdateTask({ ...task, status: s, progress });
  };
  const commitProgress = (p: number) => {
    const status: TaskStatus = p >= 100 ? 'done' : p <= 0 ? 'not_started' : 'in_progress';
    onUpdateTask({ ...task, progress: p, status });
  };
  ```
- `components/schedule/mobile/MobileScheduleList.tsx:83-87` — list-row done toggle:
  ```ts
  const markDone = (t: ScheduleTask) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const nowDone = t.status === 'done';
    onUpdateTask({ ...t, status: nowDone ? 'in_progress' : 'done', progress: nowDone ? (t.progress ?? 0) : 100 });
  };
  ```

Today's-day access: `const startDate = activeSchedule?.startDate ?? new Date().toISOString().slice(0, 10);` (`:67`) — `activeSchedule` is in scope (`:61`); the wiring calls `todayDayNumberFrom(activeSchedule?.startDate)` (no-startDate schedules treat today as day 1, matching the screen's own fallback).

#### 6c. Classic schedule (mobile + desktop classic) — `app/(tabs)/schedule/index.tsx` (EDIT TWO CALLBACKS)

- **`handleSaveTask` (`:480`)** — the edit-modal commit. The modal's status picker (`:1446-1457`) and quick-progress buttons (`:1466-1476`) only mutate `taskDraft` state; the actual write happens here (`:514-537`), building a full `updated` object from `...item`:
  ```ts
  const updated: ScheduleTask = {
    ...item, title, phase: draft.phase, crew: draft.crew.trim() || 'General crew',
    crewSize, durationDays, notes: draft.notes.trim(),
    isMilestone: draft.isMilestone, wbsCode: draft.wbsCode.trim() || undefined,
    isCriticalPath: draft.isCriticalPath, isWeatherSensitive: draft.isWeatherSensitive,
    dependencies: depIds, dependencyLinks: depLinks,
    status: draft.status, progress,
    assignedSubId: draft.assignedSubId || undefined,
    assignedSubName: draft.assignedSubName || undefined,
  };
  ```
  Persists via `persistEditedTasks` (`:447-470`: `applyToProjectSchedule` reflow → `runCpm` → `buildScheduleFromTasks` → merged save).
- **`handleProgressUpdate` (`:638-649`)** — the 25/50/75/100% quick buttons on task cards AND the task-detail modal (caller at `:2312`):
  ```ts
  const handleProgressUpdate = useCallback((task: ScheduleTask, nextProgress: number) => {
    const clamped = Math.max(0, Math.min(100, nextProgress));
    const nextStatus = clamped >= 100 ? 'done' as const : clamped > 0 ? 'in_progress' as const : 'not_started' as const;
    const nextTasks = sortedTasks.map(item =>
      item.id !== task.id ? item : { ...item, progress: clamped, status: nextStatus }
    );
    const scheduleName = activeSchedule?.name ?? 'Project Schedule';
    const nextSchedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, nextTasks, activeSchedule?.baseline);
    saveSchedule(nextSchedule, selectedProject);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [activeSchedule, saveSchedule, selectedProject, sortedTasks]);
  ```

Today's-day access: `activeSchedule?.startDate` is in scope in both callbacks (both already list `activeSchedule` in deps) → `todayDayNumberFrom(activeSchedule?.startDate)`. Do NOT use the screen's `projectStartDate` memo (`:233-241`) — it anchors to noon (see #5).

#### 6d. Audited NON-sites (no wiring needed — verified no status transition)

- `utils/copilot/scheduleEdit/editOps.ts:9-19` — the Copilot web-edit op vocabulary has **no status op**; `setProgress` applies `patch(id, { progress: op.pct })` (`interpretOps.ts:50`) without flipping status, and `addTask` creates `status: 'not_started'` (creation, not transition).
- `app/schedule-pro.tsx:713-716` — voice `handleProgressUpdate` sends `{ progress }` only (pre-existing: a spoken "100%" does not flip status; out of scope).
- `utils/voiceCommandExecutor.ts:288-294` — `case 'status_update'` just echoes text; no mutation.
- `components/schedule/tabs/BoardTab.tsx`, `ListTab.tsx`, `TodayView.tsx`, `mobile/ProgressTab.tsx`, `SubUpdatesPanel.tsx`, `MobileGantt.tsx` — read `status`, never write it.
- Task-creation sites (`schedule-pro.tsx:793/844/1000`, classic `:590/792/854/…`, `MobileScheduleScreen.tsx:124`) — new tasks born `not_started`; not transitions.

### 7. The surfacing screen — `app/schedule-review.tsx`

State + context (`:45, 52-53`):

```ts
  const { getProject, updateProject } = useProjects();
  // …
  const [draft] = useState(() => takeDraft());
  const [tasks, setTasks] = useState<ScheduleTask[]>(draft?.tasks ?? []);
```

**There is no per-task edit path on this screen today** — `setTasks` is the edit path (whole-draft `regenerate` uses it at `:116`), and `accept()` (`:74-96`) rebuilds before committing, which is where CPM/totals recompute:

```ts
  const accept = useCallback(() => {
    if (!project || !draft) return;
    const rebuilt = buildScheduleFromTasks(
      draft.schedule.name ?? 'Schedule',
      project.id,
      tasks,
      draft.schedule.baseline ?? null,
    );
    updateProject(project.id, { schedule: { ...draft.schedule, ...rebuilt, tasks } });
    // … routes to schedule-pro (wide + Pro) or classic
  }, [project, draft, tasks, updateProject, router, width, canAccess]);
```

(No `criticalPathDays` option passed ⇒ `buildScheduleFromTasks` runs its forward-pass resolver, so a chip-applied `durationDays` reflows successor `startDay`s at accept. This is the "existing edit path" the spec pointed at.) The task card render (`:187-205`) the chip slots into:

```tsx
                {phaseTasks.map(task => (
                  <View key={task.id} style={styles.taskRow}>
                    <View style={styles.taskTitleRow}>
                      <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                      {task.assumption && (
                        <View style={styles.assumptionChip}>
                          <AlertTriangle size={11} color={ASSUMPTION_COLOR} strokeWidth={2} />
                          <Text style={styles.assumptionText}>assumed</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.taskMeta}>
                      {task.durationDays}d · crew {task.crewSize ?? '—'}
                    </Text>
                    {task.rationale ? (
                      <Text style={styles.taskRationale}>{task.rationale}</Text>
                    ) : null}
                  </View>
                ))}
```

Styles idiom: `useThemedStyles(makeStyles)` factory `(t: ThemeColors) => StyleSheet.create({...})`, `Type.*` font sizes, `Tokens.radius.*`, accent-soft chips (`regenBtn` uses `backgroundColor: t.accentSoft`, `assumptionChip` uses `Tokens.radius.full`). `Platform`, `Haptics`, `useCallback`, `useMemo`, `ScheduleTask` are already imported. `useProjects()` also exposes `projects` (it spreads every data context — `contexts/ProjectContext.tsx:4023-4034`); `project.squareFootage` gives the bucket input.

### 8. Validator harness + ship-check (`package.json`, `scripts/validate-*.ts`)

Harness (identical across the suite, e.g. `scripts/validate-cost-xray.ts`): `let pass = 0, fail = 0;` + `function expect<T>(name, got, want)` comparing `JSON.stringify`, footer `console.log(\`\n${pass} passed, ${fail} failed\`); if (fail > 0) process.exit(1);`. Imports are RELATIVE (`../utils/pace/...`, `../types`). Scripts wire as `"test:pace": "bun run scripts/validate-pace.ts"` and append `&& bun run test:pace` to the `ship-check` chain (currently ends with `bun run test:copilot-split-intents`). Anti-slop (`test:app-slop`) bans emoji-as-icons, purple/pink/violet hex, and the "Inter" font — lucide icons + theme colors only.

---

## Conventions the implementer must follow

- **Capture never lies and never overwrites.** `stampActuals` only fills actuals that are unset; the Gantt's explicit buttons always win (patch-over-stamp merge in patch sinks; stamp-over-spread merge in full-object sinks — the spread carries the old actuals, the stamp only adds missing ones). No transition ever CLEARS an actual (reopening a done task keeps its history).
- **Pure functions never throw** on bad input — clamp/default/return-`{}`/return-`null` instead.
- **The chip suggests; the user decides.** No pace number is ever applied automatically, and low-confidence/no-history/agreement-within-a-day renders NOTHING (silence, not noise).
- **Day-number basis is #5's formula everywhere** — `floor((now − start@midnight)/86 400 000) + 1`, clamped ≥ 1. schedule-pro reuses its existing memo; everyone else calls `todayDayNumberFrom`.
- **Validator imports are RELATIVE** (`../utils/...`); app code uses the `@/` alias.
- **UI:** lucide icons only (`History` for the chip), `Type.*` font sizes, `Tokens.radius.*`, theme colors via `useThemedStyles` factories — match the schedule-review idioms quoted above.
- **Commit after each task** with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. `git add` only the files the task touched.
- **Gate after each task:** `npx tsc --noEmit` clean; for validator tasks the stated `bun run test:pace` count passes.

---

### Task 1: `stampActuals` + `todayDayNumberFrom` + validator scaffold (TDD)

**Files:**
- Create: `utils/pace/stampActuals.ts`
- Create: `scripts/validate-pace.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** — create `scripts/validate-pace.ts`:

```ts
// validate-pace.ts — unit tests for the Productivity Feedback Loop:
// as-built transition stamping + the pace book engine.
// Run via: bun run test:pace
import { stampActuals, todayDayNumberFrom } from '../utils/pace/stampActuals';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// ── Fixtures ──
const NOW = '2026-07-23T15:00:00.000Z';
function t(over: Partial<ScheduleTask>): ScheduleTask {
  return {
    id: 'T1', title: 'Framing walls', phase: 'Structure', durationDays: 5,
    startDay: 4, progress: 0, crew: '', dependencies: [], notes: '',
    status: 'not_started', ...over,
  } as ScheduleTask;
}

console.log('\npace stampActuals:');

expect('→in_progress stamps start today',
  stampActuals(t({}), 'in_progress', 12, NOW),
  { actualStartDay: 12, actualStartDate: NOW });
expect('→in_progress never overwrites an existing start',
  stampActuals(t({ actualStartDay: 6, actualStartDate: '2026-07-17T08:00:00.000Z' }), 'in_progress', 12, NOW),
  {});
expect('→done stamps end only, when start exists',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'done', 12, NOW),
  { actualEndDay: 12, actualEndDate: NOW });
expect('→done retro-stamps start from planned startDay (Gantt rule)',
  stampActuals(t({}), 'done', 12, NOW),
  { actualEndDay: 12, actualEndDate: NOW, actualStartDay: 4, actualStartDate: NOW });
expect('→done never overwrites an existing end',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6, actualEndDay: 9 }), 'done', 12, NOW),
  {});
expect('→on_hold never stamps',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'on_hold', 12, NOW),
  {});
expect('same-status call is a no-op',
  stampActuals(t({ status: 'in_progress' }), 'in_progress', 12, NOW),
  {});
expect('reopen (→not_started) never stamps or clears',
  stampActuals(t({ status: 'done', actualStartDay: 6, actualEndDay: 9 }), 'not_started', 12, NOW),
  {});

console.log('\npace todayDayNumberFrom:');

const NOON = new Date('2026-07-23T12:00:00');
expect('schedule started today → day 1', todayDayNumberFrom('2026-07-23', NOON), 1);
expect('schedule started 10 days ago → day 11', todayDayNumberFrom('2026-07-13', NOON), 11);
expect('future start clamps to day 1', todayDayNumberFrom('2026-08-01', NOON), 1);
expect('missing startDate → day 1', todayDayNumberFrom(undefined, NOON), 1);
expect('garbage startDate → day 1', todayDayNumberFrom('not-a-date', NOON), 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Wire the script + run to verify it fails**

In `package.json` `scripts`, add after `"test:copilot-split-intents"`:

```json
"test:pace": "bun run scripts/validate-pace.ts",
```

and append ` && bun run test:pace` to the END of the `ship-check` chain.

Run: `bun run test:pace`
Expected: FAIL — cannot find module `../utils/pace/stampActuals`.

- [ ] **Step 3: Implement `stampActuals`**

```ts
// utils/pace/stampActuals.ts — as-built capture on status transitions.
//
// The pace flywheel's intake valve: BEFORE this, actuals were only set by the
// Gantt's manual "Start today"/"Finish today" buttons
// (components/schedule/InteractiveGantt.tssx logStartToday/logFinishToday) —
// ~5% coverage. This helper mirrors those buttons' semantics (including the
// retro-start rule: finishing an unstarted task back-fills actualStartDay
// from the PLANNED startDay) so that ANY status change captures the same
// data. Rules:
//   → in_progress, start unset:  stamp actualStartDay/-Date
//   → done, end unset:           stamp actualEndDay/-Date
//                                (+ retro-stamp start from task.startDay if unset)
//   anything else, or already stamped: {} — NEVER overwrite, NEVER clear.
// The manual Gantt buttons stay authoritative: sinks merge explicit patch
// values OVER this stamp, and stampActuals no-ops on already-stamped tasks.
//
// Pure — no storage, no Date.now() (callers pass todayDayNumber + nowISO).
import type { ScheduleTask, TaskStatus } from '@/types';

export function stampActuals(
  task: Pick<ScheduleTask, 'status' | 'startDay' | 'actualStartDay' | 'actualEndDay'>,
  newStatus: TaskStatus,
  todayDayNumber: number,
  nowISO: string,
): Partial<ScheduleTask> {
  if (newStatus === task.status) return {};
  if (newStatus === 'in_progress') {
    if (task.actualStartDay != null) return {};
    return { actualStartDay: todayDayNumber, actualStartDate: nowISO };
  }
  if (newStatus === 'done') {
    if (task.actualEndDay != null) return {};
    const patch: Partial<ScheduleTask> = { actualEndDay: todayDayNumber, actualEndDate: nowISO };
    if (task.actualStartDay == null) {
      // Mirror the Gantt's logFinishToday: back-fill the start from the PLAN,
      // not from today — finishing day is rarely the starting day.
      patch.actualStartDay = task.startDay;
      patch.actualStartDate = nowISO;
    }
    return patch;
  }
  return {};
}

/**
 * Today's 1-indexed schedule day number — the InteractiveGantt basis
 * (daysBetween(projectStartDate, now) + 1 with a midnight anchor), clamped
 * to >= 1 like schedule-pro's own todayDayNumber memo. Callers that already
 * hold that memo (schedule-pro) keep using it; everyone else uses this.
 */
export function todayDayNumberFrom(scheduleStartDate: string | undefined, now: Date = new Date()): number {
  if (!scheduleStartDate) return 1;
  const parsed = Date.parse(scheduleStartDate + 'T00:00:00');
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor((now.getTime() - parsed) / 86400000) + 1);
}
```

(Note the patch's key order — `actualEndDay, actualEndDate, actualStartDay, actualStartDate` — matches the retro-stamp test's expected literal; the validator compares `JSON.stringify`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:pace`
Expected: `13 passed, 0 failed`.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add utils/pace/stampActuals.ts scripts/validate-pace.ts package.json
git commit -m "$(cat <<'EOF'
feat(pace): stampActuals transition stamping + validator scaffold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The pace book engine (TDD)

**Files:**
- Create: `utils/pace/paceBook.ts`
- Modify: `scripts/validate-pace.ts` (append cases BEFORE the footer)

- [ ] **Step 1: Append the failing tests** — in `scripts/validate-pace.ts`, extend the imports:

```ts
import { buildPaceBook, lookupPace, suggestDuration, bucketForSqft, paceConfidence } from '../utils/pace/paceBook';
import type { PaceBookEntry } from '../utils/pace/paceBook';
import type { Project } from '../types';
```

and insert the following block BEFORE the `console.log(\`\n${pass} passed…\`)` footer:

```ts
console.log('\npace bucketForSqft:');

expect('1999 → small', bucketForSqft(1999), 'small');
expect('2000 → medium', bucketForSqft(2000), 'medium');
expect('3499 → medium', bucketForSqft(3499), 'medium');
expect('3500 → large', bucketForSqft(3500), 'large');
expect('5999 → large', bucketForSqft(5999), 'large');
expect('6000 → xlarge', bucketForSqft(6000), 'xlarge');
expect('0 → unknown', bucketForSqft(0), 'unknown');
expect('undefined → unknown', bucketForSqft(undefined), 'unknown');

console.log('\npace paceConfidence:');

expect('5 jobs, cv 0.20 → high', paceConfidence(5, 0.20), 'high');
expect('5 jobs, cv 0.35 → high (inclusive edge)', paceConfidence(5, 0.35), 'high');
expect('5 jobs, cv 0.36 → medium', paceConfidence(5, 0.36), 'medium');
expect('4 jobs → medium', paceConfidence(4, 0.10), 'medium');
expect('2 jobs → low', paceConfidence(2, 0.01), 'low');

console.log('\npace buildPaceBook:');

function projWithSchedule(id: string, sqft: number, tasks: ScheduleTask[]): Project {
  return {
    id, name: `Job ${id}`, squareFootage: sqft,
    schedule: {
      id: `s-${id}`, name: 'Sched', projectId: id, workingDaysPerWeek: 5,
      bufferDays: 0, tasks, totalDurationDays: 0, criticalPathDays: 0,
      laborAlignmentScore: 0, riskItems: [],
    },
  } as unknown as Project;
}

const book = buildPaceBook([
  projWithSchedule('P1', 1800, [
    t({ id: 'f1', tradeKey: 'framing', durationDays: 7, actualStartDay: 3, actualEndDay: 10, actualEndDate: '2026-06-01' }),
    t({ id: 'pl1', title: 'Rough plumbing install', durationDays: 4, actualStartDay: 5, actualEndDay: 8, actualEndDate: '2026-06-05' }),
    t({ id: 'st1', tradeKey: 'steel', durationDays: 3, actualStartDay: 4 }),                          // end never captured → excluded
    t({ id: 'ms1', tradeKey: 'roofing', durationDays: 0, isMilestone: true, actualStartDay: 1, actualEndDay: 1 }), // milestone → excluded
  ]),
  projWithSchedule('P2', 1800, [
    t({ id: 'f2', tradeKey: 'framing', durationDays: 7, actualStartDay: 1, actualEndDay: 12, actualEndDate: '2026-07-01' }),
  ]),
  projWithSchedule('P3', 4000, [
    t({ id: 'f3', tradeKey: 'framing', durationDays: 6, actualStartDay: 2, actualEndDay: 7, actualEndDate: '2026-07-10' }),
    t({ id: 'c3', tradeKey: 'concrete', durationDays: 2, actualStartDay: 9, actualEndDay: 5, actualEndDate: '2026-07-12' }), // reversed → clamp 1
  ]),
  projWithSchedule('P4', 2500, [
    t({ id: 'n4', tradeKey: 'framing', durationDays: 5 }),                                            // no actuals → excluded
  ]),
]);

expect('jobsAnalyzed counts only contributing projects', book.jobsAnalyzed, 3);
expect('tradesTracked counts distinct trades', book.tradesTracked, 3);
expect('no sample without BOTH actuals (steel absent)', lookupPace(book, 'steel', 1800), null);
expect('milestones excluded (roofing absent)', lookupPace(book, 'roofing', 1800), null);

const framingSmall = lookupPace(book, 'framing', 1800)!;
expect('exact-bucket lookup hits framing|small', framingSmall.key, 'framing|small');
expect('sampleCount', framingSmall.sampleCount, 2);
expect('jobCount', framingSmall.jobCount, 2);
expect('plannedMean', framingSmall.plannedMean, 7);
expect('actualMean', framingSmall.actualMean, 10);
expect('bias ≈ +42.9% (plans optimistic)', Math.round(framingSmall.bias * 1000), 429);
expect('variability cv 0.2', framingSmall.variability, 0.2);
expect('confidence low at 2 jobs', framingSmall.confidence, 'low');
expect('newest sample first', framingSmall.samples[0], {
  projectId: 'P2', projectName: 'Job P2', trade: 'framing', sqftBucket: 'small',
  plannedDays: 7, actualDays: 12, completedAt: '2026-07-01',
});

expect('trade inferred from title (plumbing)', lookupPace(book, 'plumbing', 1800)?.sampleCount, 1);
expect('reversed actuals clamp to 1 day', lookupPace(book, 'concrete', 4000)?.actualMean, 1);

expect('bucket miss falls back to trade-wide |all', lookupPace(book, 'framing', 2500)?.key, 'framing|all');
expect('|all jobCount spans buckets', lookupPace(book, 'framing', 2500)?.jobCount, 3);
expect('unknown sqft falls back to |all', lookupPace(book, 'framing', undefined)?.key, 'framing|all');
expect('unknown trade → null', lookupPace(book, 'hvac', 1800), null);

console.log('\npace suggestDuration:');

const pe = (over: Partial<PaceBookEntry>): PaceBookEntry => ({
  key: 'framing|small', trade: 'framing', sqftBucket: 'small',
  sampleCount: 4, jobCount: 4, plannedMean: 7, actualMean: 11,
  variability: 0.2, bias: 0.57, confidence: 'medium', samples: [], ...over,
});
expect('blend: 4 jobs, planned 7, your mean 11 → 9', suggestDuration(pe({}), 7), 9);
expect('blend: 1 job leans on the plan (mean 20, proposed 5 → 9)', suggestDuration(pe({ jobCount: 1, actualMean: 20 }), 5), 9);
expect('floor at 1 day', suggestDuration(pe({ jobCount: 5, actualMean: 1 }), 1), 1);
```

Pinned math, hand-checked: framing|small actuals `[8, 12]` (f1: 10−3+1 = 8; f2: 12−1+1 = 12) → mean 10; planned `[7, 7]` → mean 7; bias (10−7)/7 = 0.42857 → ×1000 rounds to 429; variance ((8−10)² + (12−10)²)/2 = 4 → sd 2 → cv 2/10 = 0.2. `|all` fallback: bucketForSqft(2500) = medium has no framing entry → `framing|all` aggregates P1+P2+P3 → jobCount 3. Blend: w = 4/(4+3) = 4/7 → (3/7)·7 + (4/7)·11 = 9.2857 → 9; w = 1/4 → 0.75·5 + 0.25·20 = 8.75 → 9.

- [ ] **Step 2: Run to verify the new cases fail**

Run: `bun run test:pace`
Expected: FAIL — cannot find module `../utils/pace/paceBook`.

- [ ] **Step 3: Implement the engine** — create `utils/pace/paceBook.ts`:

```ts
// utils/pace/paceBook.ts — your pace, learned from your finished work.
//
// Time-twin of utils/costDatabase.ts (money): reads every project's schedule,
// takes tasks whose as-built dates were captured (both actualStartDay AND
// actualEndDay — utils/pace/stampActuals.ts is the capture flywheel), and
// distils per-trade duration entries: what "Framing" ACTUALLY takes this
// contractor, by project-size bucket, with a variability band and a read on
// whether they plan optimistic. Samples come from ALL projects, not only
// closed ones — a finished task on an active job is a valid pace sample.
//
// Cold-start mirrors the cost DB: suggestDuration blends the AI's proposed
// duration (the prior) toward the measured mean with w = n/(n+K), K=3 — with
// one job it leans on the plan; by the fifth it's mostly your real pace.
//
// Pure function — no storage, no network. Derived live from ProjectContext
// data via useMemo where surfaced.
import type { Project, ScheduleTask } from '@/types';
import { tradeKeyForTask } from '@/utils/scheduleColors';

/** Blend constant: at n jobs, personal weight = n/(n+K). K=3 ⇒ 50/50 at n=3. */
export const PACE_BLEND_K = 3;

export type SqftBucket = 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';

export interface PaceSample {
  projectId: string;
  projectName: string;
  /** tradeKeyForTask(task) — explicit tradeKey, else conservative name inference. */
  trade: string;
  /** The source project's size bucket (a real SqftBucket, even inside `|all`). */
  sqftBucket: string;
  /** task.durationDays at sampling time — the plan. */
  plannedDays: number;
  /** actualEndDay − actualStartDay + 1, clamped ≥ 1 — the reality. */
  actualDays: number;
  completedAt: string;
}

export interface PaceBookEntry {
  /** `${trade}|${sqftBucket}` — plus a `${trade}|all` trade-wide aggregate. */
  key: string;
  trade: string;
  /** SqftBucket, or 'all' on the trade-wide aggregate entry. */
  sqftBucket: string;
  sampleCount: number;
  jobCount: number;
  plannedMean: number;
  actualMean: number;
  /** Coefficient of variation of actualDays (0.2 = ±20% spread). */
  variability: number;
  /** (actualMean − plannedMean) / plannedMean. >0 = you plan optimistic. */
  bias: number;
  confidence: 'low' | 'medium' | 'high';
  samples: PaceSample[];
}

export interface PaceBook {
  entries: PaceBookEntry[];
  jobsAnalyzed: number;
  /** Distinct trades (the |all aggregates would double-count entries). */
  tradesTracked: number;
  asOf: string;
}

/** Project-size buckets: small <2000 | medium 2000–3499 | large 3500–5999 | xlarge ≥6000. */
export function bucketForSqft(sqft: number | null | undefined): SqftBucket {
  if (typeof sqft !== 'number' || !Number.isFinite(sqft) || sqft <= 0) return 'unknown';
  if (sqft < 2000) return 'small';
  if (sqft < 3500) return 'medium';
  if (sqft < 6000) return 'large';
  return 'xlarge';
}

/** jobCount≥5 with cv≤0.35 → high; jobCount≥3 → medium; else low.
 *  (Looser cv edge than the cost book's 0.2 — durations are noisier than
 *  unit prices; per the approved spec.) */
export function paceConfidence(jobCount: number, variability: number): PaceBookEntry['confidence'] {
  if (jobCount >= 5 && variability <= 0.35) return 'high';
  if (jobCount >= 3) return 'medium';
  return 'low';
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function buildPaceBook(projects: Project[]): PaceBook {
  const asOf = new Date().toISOString();
  const groups = new Map<string, PaceSample[]>();
  const jobs = new Set<string>();

  const push = (key: string, s: PaceSample) => {
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  };

  for (const project of projects ?? []) {
    const tasks: ScheduleTask[] = project?.schedule?.tasks ?? [];
    const sqftBucket = bucketForSqft(project?.squareFootage);
    let contributed = false;
    for (const task of tasks) {
      if (!task) continue;
      // Milestones carry no duration signal; a task becomes a sample only
      // once BOTH as-built ends were captured.
      if (task.isMilestone || !(task.durationDays > 0)) continue;
      if (typeof task.actualStartDay !== 'number' || typeof task.actualEndDay !== 'number') continue;
      const sample: PaceSample = {
        projectId: project.id,
        projectName: project.name,
        trade: tradeKeyForTask(task),
        sqftBucket,
        plannedDays: Math.max(1, Math.round(task.durationDays)),
        actualDays: Math.max(1, task.actualEndDay - task.actualStartDay + 1),
        completedAt: task.actualEndDate ?? '',
      };
      push(`${sample.trade}|${sample.sqftBucket}`, sample);
      push(`${sample.trade}|all`, { ...sample });
      contributed = true;
    }
    if (contributed) jobs.add(project.id);
  }

  const entries: PaceBookEntry[] = [];
  for (const [key, ss] of groups) {
    const actualMean = mean(ss.map(s => s.actualDays));
    const plannedMean = mean(ss.map(s => s.plannedDays));
    const variance = mean(ss.map(s => (s.actualDays - actualMean) ** 2));
    const variability = actualMean > 0 ? Math.sqrt(variance) / actualMean : 0;
    const bias = plannedMean > 0 ? (actualMean - plannedMean) / plannedMean : 0;
    const jobCount = new Set(ss.map(s => s.projectId)).size;
    const sorted = [...ss].sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
    const [trade, sqftBucket] = key.split('|');
    entries.push({
      key,
      trade,
      sqftBucket,
      sampleCount: ss.length,
      jobCount,
      plannedMean,
      actualMean,
      variability,
      bias,
      confidence: paceConfidence(jobCount, variability),
      samples: sorted,
    });
  }

  const tradesTracked = new Set(entries.map(e => e.trade)).size;
  return { entries, jobsAnalyzed: jobs.size, tradesTracked, asOf };
}

/** Exact size-bucket entry first, then the trade-wide `|all` aggregate. */
export function lookupPace(book: PaceBook, trade: string, sqft: number | undefined): PaceBookEntry | null {
  const t = (trade || '').trim().toLowerCase();
  if (!t) return null;
  const exact = book.entries.find(e => e.key === `${t}|${bucketForSqft(sqft)}`);
  if (exact) return exact;
  return book.entries.find(e => e.key === `${t}|all`) ?? null;
}

/** Blend the proposed duration toward your measured mean: w = jobCount/(jobCount+K). */
export function suggestDuration(entry: PaceBookEntry, proposedDays: number): number {
  const w = entry.jobCount / (entry.jobCount + PACE_BLEND_K);
  return Math.round(Math.max(1, (1 - w) * proposedDays + w * entry.actualMean));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:pace`
Expected: `48 passed, 0 failed` (13 from Task 1 + 35 new).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add utils/pace/paceBook.ts scripts/validate-pace.ts
git commit -m "$(cat <<'EOF'
feat(pace): pace book engine — buildPaceBook / lookupPace / suggestDuration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire `stampActuals` into every status-change sink

**Files:**
- Modify: `app/schedule-pro.tsx`
- Modify: `components/schedule/mobile/MobileScheduleScreen.tsx`
- Modify: `app/(tabs)/schedule/index.tsx`

> **Do not touch `InteractiveGantt.tsx`** — its `logStartToday`/`logFinishToday` route through `handleEdit` like every other patch, and the sink's merge order (`{ ...stamp, ...patch }`) plus the helper's never-overwrite rule guarantee their explicit values win with no double-stamp (Grounded reality #5/#6a).

- [ ] **Step 1: Desktop/web Pro sink** — in `app/schedule-pro.tsx`, add the import with the other `@/utils/*` imports:

```ts
import { stampActuals } from '@/utils/pace/stampActuals';
```

Then replace `handleEdit` (`:615-635`, quoted in Grounded reality #6a) with:

```ts
  const handleEdit = useCallback((taskId: string, patch: Partial<ScheduleTask>) => {
    const before = workingTasks.find(t => t.id === taskId);
    // Pace flywheel: status transitions auto-stamp as-built days. The stamp
    // sits UNDER the incoming patch, so the Gantt's explicit Start/Finish-
    // today values always win, and stampActuals never touches already-set
    // actuals. todayDayNumber is this screen's clamped memo — the same basis
    // the Gantt renders with.
    const effective: Partial<ScheduleTask> =
      before && patch.status !== undefined && patch.status !== before.status
        ? { ...stampActuals(before, patch.status, todayDayNumber, new Date().toISOString()), ...patch }
        : patch;
    // Log to the audit before applying so we have the "before" snapshot.
    if (before && project?.id) {
      const isLogicChange = 'dependencies' in effective || 'dependencyLinks' in effective;
      const isProgressChange = 'progress' in effective && effective.progress !== before.progress;
      const entry = buildAuditEntry({
        user: user?.email ?? user?.name ?? 'anonymous',
        taskId,
        taskTitle: before.title,
        kind: isLogicChange ? 'dependency_edit'
          : isProgressChange ? 'progress_update'
          : 'task_edit',
        summary: summarizeTaskDiff(before as unknown as Record<string, unknown>, { ...before, ...effective } as unknown as Record<string, unknown>),
        before: before as unknown as Record<string, unknown>,
        after: { ...before, ...effective } as unknown as Record<string, unknown>,
      });
      void appendAuditToAsyncStorage(project.id, entry);
    }
    commit(prev => prev.map(t => (t.id === taskId ? { ...t, ...effective } : t)));
  }, [commit, workingTasks, project?.id, user, todayDayNumber]);
```

(Note `todayDayNumber` added to the dep array. The audit now records the stamped fields too — the as-built capture shows up in the schedule audit trail for free.)

- [ ] **Step 2: Mobile Pro sink** — in `components/schedule/mobile/MobileScheduleScreen.tsx`, add the import:

```ts
import { stampActuals, todayDayNumberFrom } from '@/utils/pace/stampActuals';
```

Then replace `onUpdateTask` (`:96-99`, quoted in Grounded reality #6b) with:

```ts
  const onUpdateTask = useCallback((next: ScheduleTask) => {
    // Pace flywheel: this is a full-object sink — `next` spreads the previous
    // task, so it already carries any existing actuals. The stamp (computed
    // from the PREVIOUS task + the NEW status) only adds fields that were
    // unset, so merging it over `next` never overwrites history.
    const prev = tasks.find((t) => t.id === next.id);
    const stamped: ScheduleTask = prev && next.status !== prev.status
      ? { ...next, ...stampActuals(prev, next.status, todayDayNumberFrom(activeSchedule?.startDate), new Date().toISOString()) }
      : next;
    saveTasks(tasks.map((t) => (t.id === stamped.id ? stamped : t)));
    setDetailTask(stamped);
  }, [tasks, saveTasks, activeSchedule?.startDate]);
```

This covers TaskDetailSheet's `setStatus` + `commitProgress` and MobileScheduleList's `markDone` (Grounded reality #6b) without touching those components.

- [ ] **Step 3: Classic schedule — two callbacks** — in `app/(tabs)/schedule/index.tsx`, add the import:

```ts
import { stampActuals, todayDayNumberFrom } from '@/utils/pace/stampActuals';
```

**3a — `handleSaveTask` (edit-modal commit).** Inside the `if (editing)` branch, directly after the `updated` object literal closes (old code quoted in Grounded reality #6c), old:

```ts
          assignedSubId: draft.assignedSubId || undefined,
          assignedSubName: draft.assignedSubName || undefined,
        };
        // Calendar-picked start date wins over day-number override.
```

new:

```ts
          assignedSubId: draft.assignedSubId || undefined,
          assignedSubName: draft.assignedSubName || undefined,
        };
        // Pace flywheel: a status change in the edit modal stamps as-builts.
        // `updated` spreads `...item`, so existing actuals are already carried;
        // stampActuals only fills the unset ones (never overwrites).
        // NOT the screen's projectStartDate memo — that anchors to noon and
        // would compute day 0 on the morning of day 1.
        if (draft.status !== item.status) {
          Object.assign(updated, stampActuals(item, draft.status, todayDayNumberFrom(activeSchedule?.startDate), new Date().toISOString()));
        }
        // Calendar-picked start date wins over day-number override.
```

(`activeSchedule` is already in this callback's dependency array.)

**3b — `handleProgressUpdate` (25/50/75/100% quick buttons + task-detail modal).** Old (`:641-643`):

```ts
    const nextTasks = sortedTasks.map(item =>
      item.id !== task.id ? item : { ...item, progress: clamped, status: nextStatus }
    );
```

new:

```ts
    const nextTasks = sortedTasks.map(item =>
      item.id !== task.id ? item : {
        ...item, progress: clamped, status: nextStatus,
        // Pace flywheel: quick-progress implies status moves — stamp the
        // as-builts on the transition (no-op when already stamped).
        ...(nextStatus !== item.status
          ? stampActuals(item, nextStatus, todayDayNumberFrom(activeSchedule?.startDate), new Date().toISOString())
          : {}),
      }
    );
```

(`activeSchedule` is already in this callback's dependency array too. The task-detail modal caller at `:2312` also refreshes its local `setTaskDetailModal` copy — that local copy not carrying the stamp is cosmetic; the store write above is what persists, and the modal re-derives on reopen.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && bun run test:pace && bun run lint`
Expected: tsc clean; `48 passed, 0 failed`; lint clean.

Manual trace (against the census in Grounded reality #6 — confirm each row funnels into an edited sink):

| Touchpoint | Funnels through | Stamped by |
|---|---|---|
| GridPane status chip cycle (`:1125`) | `handleEdit` | Step 1 |
| GridPane row menu "Mark complete" (`:433`) | `handleEdit` | Step 1 |
| GridPane progress-cell status flip (`:669-670`) | `handleEdit` | Step 1 |
| TaskInspector status chips (`:195`) | `handleEdit` | Step 1 |
| Gantt bar menu "Mark complete" (`:205`) | `handleEdit` | Step 1 |
| Gantt Start/Finish-today (`:616-638`) | `handleEdit` | already explicit — patch wins, helper no-ops |
| TaskDetailSheet setStatus/commitProgress (`:89-98`) | `onUpdateTask` | Step 2 |
| MobileScheduleList markDone (`:83-87`) | `onUpdateTask` | Step 2 |
| Classic edit-modal save (`:522` via draft pickers `:1446-1476`) | `handleSaveTask` | Step 3a |
| Classic quick-progress buttons (+ modal `:2312`) | `handleProgressUpdate` | Step 3b |

- [ ] **Step 5: Commit**

```bash
git add app/schedule-pro.tsx components/schedule/mobile/MobileScheduleScreen.tsx "app/(tabs)/schedule/index.tsx"
git commit -m "$(cat <<'EOF'
feat(pace): auto-stamp as-built dates on every task status change

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: PaceChip + schedule-review integration

**Files:**
- Create: `components/schedule/PaceChip.tsx`
- Modify: `app/schedule-review.tsx`

- [ ] **Step 1: Create `components/schedule/PaceChip.tsx`**

```tsx
// components/schedule/PaceChip.tsx — "Your pace: 9d (4 jobs)" suggestion chip.
//
// Rendered on schedule-review task cards when the pace book knows this trade
// at medium+ confidence AND disagrees with the AI's proposed duration by at
// least a day. Tapping applies the suggestion; it is never automatic, and
// low-confidence/no-history renders nothing (silence, not noise). The small
// dot signals confidence: accent = medium, success-green = high.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { History } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface PaceChipProps {
  suggestedDays: number;
  jobCount: number;
  confidence: 'medium' | 'high';
  onApply: () => void;
}

export default function PaceChip({ suggestedDays, jobCount, confidence, onApply }: PaceChipProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={onApply}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Use your pace: ${suggestedDays} days, from ${jobCount} past ${jobCount === 1 ? 'job' : 'jobs'}`}
      testID="pace-chip"
    >
      <History size={11} color={t.accent} strokeWidth={2} />
      <Text style={styles.text}>
        Your pace: {suggestedDays}d ({jobCount} job{jobCount === 1 ? '' : 's'})
      </Text>
      <View style={[styles.dot, { backgroundColor: confidence === 'high' ? t.success : t.accent }]} />
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  chip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft, marginTop: 3,
  },
  text: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.accent, letterSpacing: 0.2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
```

- [ ] **Step 2: Wire it into `app/schedule-review.tsx`** — add imports (below the existing `@/utils/*` imports):

```ts
import { buildPaceBook, lookupPace, suggestDuration } from '@/utils/pace/paceBook';
import { tradeKeyForTask } from '@/utils/scheduleColors';
import PaceChip from '@/components/schedule/PaceChip';
```

Extend the `useProjects()` destructure (`:45`), old:

```ts
  const { getProject, updateProject } = useProjects();
```

new:

```ts
  const { getProject, updateProject, projects } = useProjects();
```

- [ ] **Step 3: Pace lookup + apply callbacks** — insert after the `assumptionCount` memo (`:72`):

```ts
  // Your-pace suggestions — the pace book is derived live from ALL projects'
  // captured as-builts (utils/pace/paceBook.ts). paceFor returns null when
  // the book should stay silent: no/low-confidence history, milestone, or
  // agreement with the AI within a day. Silence, not noise.
  const paceBook = useMemo(() => buildPaceBook(projects), [projects]);

  const paceFor = useCallback((task: ScheduleTask): { days: number; jobCount: number; confidence: 'medium' | 'high' } | null => {
    if (task.isMilestone || task.durationDays <= 0) return null;
    const entry = lookupPace(paceBook, tradeKeyForTask(task), project?.squareFootage);
    if (!entry) return null;
    const confidence = entry.confidence;
    if (confidence === 'low') return null;
    const days = suggestDuration(entry, task.durationDays);
    if (Math.abs(days - task.durationDays) < 1) return null;
    return { days, jobCount: entry.jobCount, confidence };
  }, [paceBook, project?.squareFootage]);

  const applyPace = useCallback((taskId: string, days: number) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // The screen's edit path: accept() rebuilds via buildScheduleFromTasks,
    // whose forward pass reflows dependent startDays from the new duration.
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, durationDays: days } : t)));
  }, []);
```

- [ ] **Step 4: Render the chip** — replace the task-card map (`:187-205`, old code quoted in Grounded reality #7) with a block body that computes the pace once per task and slots the chip between the meta line and the rationale:

```tsx
                {phaseTasks.map(task => {
                  const pace = paceFor(task);
                  return (
                    <View key={task.id} style={styles.taskRow}>
                      <View style={styles.taskTitleRow}>
                        <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                        {task.assumption && (
                          <View style={styles.assumptionChip}>
                            <AlertTriangle size={11} color={ASSUMPTION_COLOR} strokeWidth={2} />
                            <Text style={styles.assumptionText}>assumed</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.taskMeta}>
                        {task.durationDays}d · crew {task.crewSize ?? '—'}
                      </Text>
                      {pace && (
                        <PaceChip
                          suggestedDays={pace.days}
                          jobCount={pace.jobCount}
                          confidence={pace.confidence}
                          onApply={() => applyPace(task.id, pace.days)}
                        />
                      )}
                      {task.rationale ? (
                        <Text style={styles.taskRationale}>{task.rationale}</Text>
                      ) : null}
                    </View>
                  );
                })}
```

After a tap, `task.durationDays` equals the suggestion, so `paceFor` returns null and the chip disappears — the built-in "applied" affordance, no extra state.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && bun run lint && bun run test:app-slop`
Expected: all clean. (Chip uses a lucide `History` icon, theme tokens only — no emoji, no banned hues, no font overrides.)

Behavior sanity (no history in dev store ⇒ no chips anywhere — correct empty state; to see a chip, a dev-seeded project with stamped framing actuals plus a fresh AI draft on a same-bucket project will show "Your pace" once ≥3 jobs exist).

- [ ] **Step 6: Commit**

```bash
git add components/schedule/PaceChip.tsx app/schedule-review.tsx
git commit -m "$(cat <<'EOF'
feat(pace): "Your pace" chip on schedule review — one tap to use your real duration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full ship-check + review

- [ ] **Step 1: Run the full gate**

Run: `bun run ship-check`
Expected: EXIT 0 — typecheck + lint + the whole validator suite including `test:pace` (`48 passed, 0 failed`).

- [ ] **Step 2: Review checklist** (fix + commit anything found):

- `git grep -n "stampActuals" app/ components/` → exactly the four wired sinks (`schedule-pro.tsx`, `MobileScheduleScreen.tsx`, `app/(tabs)/schedule/index.tsx` ×2) and NOTHING in `InteractiveGantt.tsx`.
- In `schedule-pro.tsx` `handleEdit`: the merge is `{ ...stampActuals(...), ...patch }` (stamp UNDER patch), and `todayDayNumber` is in the dep array.
- In the two full-object sinks: the stamp merges OVER the object (`{ ...next, ...stamp }` / `Object.assign(updated, stamp)` / spread-last) — safe because the object spreads the previous task and the stamp only contains previously-unset fields.
- No call site computes the day number from the classic screen's noon-anchored `projectStartDate` memo.
- `buildPaceBook` is called exactly once per screen render tree (a single `useMemo` in schedule-review) — no per-task rebuilds.
- The chip renders only when `confidence !== 'low'` AND `|suggested − proposed| ≥ 1` AND the task is not a milestone; tapping routes through `setTasks` (the path `accept()` rebuilds from).
- No new AsyncStorage keys, no supabase payload changes, no type changes in `types/index.ts` (`git diff main --stat` shows only the files in File Structure).

- [ ] **Step 3:** Branch is ready for the adversarial-review workflow (stamping-semantics + blend-math verification) before merge. Deploy (merge + OTA) stays owner-gated.

---

## Self-Review

**Spec coverage:** Part 1 capture — `stampActuals` with the spec's exact transition rules (start-on-in_progress, end-on-done, retro-start from `task.startDay` mirroring `InteractiveGantt.tsx:625-638`, never-overwrite, `{}` otherwise) → Task 1; wired into every status-change path found by the census → Task 3 (the spec listed widget-level sites; the code has three funnel sinks that cover all ten touchpoints — same coverage, fewer seams, and the Gantt stays untouched with a no-double-stamp guarantee). Part 2 — `PaceSample`/`PaceBookEntry`/`buildPaceBook`/`lookupPace`/`suggestDuration` with the spec's exact shapes, bucket edges (1999/2000/3500/6000 pinned), `w = jobCount/(jobCount+3)` blend (4-jobs/7-planned/11-mean → 9 pinned), confidence bands (`≥5 && cv≤0.35` high / `≥3` medium), `|all` trade-wide fallback entries, all-projects sampling, both-actuals + milestone-exclusion + clamp-≥1 rules → Task 2. Part 3 — PaceChip on schedule-review when `confidence !== 'low'` and `|suggested − proposed| ≥ 1`, tap applies through the screen's edit path (`setTasks` → `accept()` rebuild), confidence dot, silent empty state → Task 4. Testing — `scripts/validate-pace.ts` as `test:pace` in ship-check, tsc strict, anti-slop → Tasks 1, 2, 5. Out-of-scope items (TimeEntry linking, daily-report cascade, recency decay, crew normalization, GridPane hints, wizard seeding, silent AI blending) untouched. **No gaps.**

**Placeholder scan:** every code step contains complete, real code built against quoted current sources; commands carry exact expected outputs (validator counts 13/48 hand-tallied against the `expect()` calls; the retro-stamp test's key order matches the implementation's construction order, noted inline).

**Type consistency:** `stampActuals` takes/returns `Partial<ScheduleTask>` against the real `TaskStatus` union (`types/index.ts:432`) — consumed identically in all four wirings. `PaceSample`/`PaceBookEntry`/`PaceBook`/`SqftBucket` defined once in Task 2, consumed by the Task 2 validator (relative import) and Task 4 screen (`@/` alias). `paceFor`'s narrowed `'medium' | 'high'` return matches `PaceChipProps.confidence` exactly (narrowing via a local `const confidence`, noted). `todayDayNumberFrom(string | undefined)` matches every call site (`activeSchedule?.startDate` is `string | undefined`). No `types/index.ts` edits — all persisted fields pre-exist.
