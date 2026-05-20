# v2.2c — Per-Resource Calendars (Layer B) — Design

Follow-on to v2.2b (Layer A — project calendar). Layer B teaches the CPM engine to resolve per-task calendars via the existing `resolveCalendarForTask` helper, so a task assigned to a "Drywall — Mon-Sat" resource calendar honors that 6-day week while a task on the default project calendar uses Mon-Fri.

Compressed spec because the design is largely a natural extension of v2.2b's Layer A pattern.

## 1. Problem

`utils/scheduleResourceCalendars.ts:resolveCalendarForTask(task, schedule) → ResolvedCalendar` exists but is never called by `runCpm`. The audit flagged it as dead code; v2.1 preserved it specifically for this v2.2c integration. Today, every task uses the project-level `workingDaysPerWeek + nonWorkingDates`, even when its resource has a different calendar.

## 2. Architecture

Engine doesn't import `ProjectSchedule` or call `resolveCalendarForTask` directly. Caller builds a per-task calendar map and passes it via `RunCpmOptions`. Engine looks up per task; falls back to project-level when missing.

### 2.1 RunCpmOptions addition

```ts
export interface RunCpmOptions {
  // ... existing fields ...
  /**
   * v2.2c — Per-task calendar override. Caller builds this via
   * resolveCalendarForTask(task, schedule). Missing entries fall back
   * to the project-level workingDaysPerWeek + nonWorkingDates.
   * Default behavior (no map provided): every task uses project-level —
   * identical to v2.2b Layer A.
   */
  taskCalendars?: Map<string, { workingDaysPerWeek: number; closures: string[] }>;
}
```

### 2.2 forwardPass + backwardPass internal signatures

Both gain one new optional param:

```ts
function forwardPass(
  ordered, all,
  scheduleStart?, workingDaysPerWeek?, nonWorkingDates?,
  taskCalendars?: Map<string, { workingDaysPerWeek: number; closures: string[] }>,
)
```

Inside each pass, after deriving the project-level `wdPerWeek` + `closuresSet` defaults (v2.2b code), add a per-task lookup helper:

```ts
function calendarForTask(taskId: string): { wd: number; closures: Set<string> } {
  const cal = taskCalendars?.get(taskId);
  if (!cal) return { wd: wdPerWeek, closures: closuresSet };
  return { wd: cal.workingDaysPerWeek, closures: new Set(cal.closures) };
}
```

Inside the per-task loop, replace `wdPerWeek` + `closuresSet` usage with the resolved values:

```ts
for (const task of ordered) {
  // ... dependency math ...
  const { wd: taskWd, closures: taskClosures } = calendarForTask(task.id);
  // ... EF computation uses taskWd + taskClosures ...
  // ... anchor math uses taskWd + taskClosures ...
}
```

Same in backward pass (LS + anchor sites).

### 2.3 Closure Set caching consideration

Building a `new Set(cal.closures)` inside the per-task loop is O(C) per task. For schedules with many tasks + many closures, that adds up.

Optimization: cache resolved calendars by reference in a `Map<taskId, { wd, closures: Set<string> }>` derived once at the top of the pass:

```ts
const resolvedCalendars = new Map<string, { wd: number; closures: Set<string> }>();
function calendarForTask(taskId: string) {
  const cached = resolvedCalendars.get(taskId);
  if (cached) return cached;
  const cal = taskCalendars?.get(taskId);
  const resolved = cal
    ? { wd: cal.workingDaysPerWeek, closures: new Set(cal.closures) }
    : { wd: wdPerWeek, closures: closuresSet };
  resolvedCalendars.set(taskId, resolved);
  return resolved;
}
```

This way each task's closures Set is built once per pass, not per site. Same instance reused for EF + LS + 4 anchor sites = ~6x fewer Set constructions per task.

### 2.4 schedule-pro caller — build the map

```ts
const taskCalendars = useMemo(() => {
  if (!project?.schedule) return undefined;
  const map = new Map<string, { workingDaysPerWeek: number; closures: string[] }>();
  for (const task of rolledTasks) {
    if (task.resourceIds && task.resourceIds.length > 0) {
      const resolved = resolveCalendarForTask(task, project.schedule);
      // Only add if it differs from project default — saves map size.
      if (resolved.source !== 'project') {
        map.set(task.id, {
          workingDaysPerWeek: resolved.workingDaysPerWeek,
          closures: resolved.closures,
        });
      }
    }
  }
  return map.size > 0 ? map : undefined;
}, [rolledTasks, project?.schedule]);
```

Then thread into the `runCpm` call (already has the v2.2b deps array).

## 3. Default behavior preservation

When `taskCalendars` is undefined OR a task's id isn't in the map, the helper falls back to the v2.2b project-level `wdPerWeek` + `closuresSet`. Schedules without any resource-assigned tasks produce identical EF/LS values pre-vs-post v2.2c. Critical regression-prevention property.

## 4. Touched files

| # | File | Change |
|---|---|---|
| 1 | `utils/cpm.ts` | T1: `RunCpmOptions.taskCalendars?` field. T2: thread through `forwardPass` + `backwardPass` signatures + per-task lookup helper inside each pass body. Replace `wdPerWeek` + `closuresSet` usage at 6 calendar-aware sites (forward EF, backward LS, forward efExact/efMin, backward esExact/esMax) with per-task resolved values. Update `runCpm` callsites of forwardPass + backwardPass. |
| 2 | `app/schedule-pro.tsx` | T3: build the `taskCalendars` map via `useMemo` over `resolveCalendarForTask` per task; pass into the existing `runCpm` callsite + add to deps array. |

**2 files. 3 tasks. Same shape as v2.2b but smaller per-file delta because the calendar-aware sites already exist — we just swap which (wdPerWeek, closures) pair is used per task.**

## 5. Verification

`npx tsc --noEmit` clean per task. Manual reasoning checks:

1. **No resource calendars in schedule** — `taskCalendars` is `undefined`. Helper returns project-level. Behavior identical to v2.2b. ✓
2. **Task with no resourceIds** — caller doesn't add it to map. Helper returns project-level. ✓
3. **Task with resource on "Drywall — 6-day" calendar (Mon-Sat)** — task spans 5 working days from Monday: Mon, Tue, Wed, Thu, Fri = day 5. EF = Friday. v2.2b project default (Mon-Fri) would also give Friday — same result for short spans inside the 5-day overlap. ✓
4. **Same task spanning weekend, on "Drywall — 6-day" calendar** — 5 working days from Friday: Sat (count 2, since Drywall works Saturdays), Mon (3), Tue (4), Wed (5). EF = Wednesday. v2.2b project default (Mon-Fri) would give Thursday. **Diverges correctly** per the per-task calendar.
5. **Anchor on a Drywall task with `efExact = day 20`** — walks back working days using the Drywall calendar (Mon-Sat). Correct ES per the task's own calendar.

## 6. Out of scope (future)

- **v2.2d — per-task calendar UI controls.** Currently `task.resourceIds` is the only signal; future could add per-task calendar override directly via the TaskInspector. Speculative.
- **Calendar conflict surfacing** — when two tasks share a resource but have conflicting calendars (one says Mon-Sat, another resource calendar says Tue-Fri), today's `resolveCalendarForTask` picks the first resource's calendar. A "calendar conflict" warning could be surfaced. Speculative.
