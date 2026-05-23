# Mobile Schedule Pro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`). The SQL-free, app-only build is OTA-able. Execute inline (cohesive UI + visual fidelity to the reference).

**Goal:** A mobile-native iOS "Schedule Pro" matching the user's reference — polished mobile gantt + rich task-detail sheet + sub-tabs (Schedule / 4D-coming-soon / Progress / Team), MAGE orange theme, reusing the schedule engine.

**Architecture:** New `components/schedule/mobile/*` built clean alongside the 3,607-line monolith (not bloating it); rendered on phones via `useResponsiveLayout().isPhone`; web keeps `schedule-pro.tsx`. Persists through the existing `updateProject(id, { schedule })` path. One engine fix (`startDate`) + one new field (`checklist`).

**Tech Stack:** React Native / Expo Router, TypeScript strict, lucide-react-native, existing `utils/scheduleEngine.ts`, theme tokens.

**Spec:** `docs/superpowers/specs/2026-05-23-mobile-schedule-pro-design.md` (@ eaeea72). **Visual target:** user reference screenshot (adapt purple → MAGE orange).

**Per-task gate:** `npx tsc --noEmit` clean.

---

## Task 1: Data + engine fix (also fixes the dashboard audit bug)

**Files:** `types/index.ts`, `utils/scheduleEngine.ts`, `app/(tabs)/schedule/index.tsx`

- [ ] **Step 1: Add the checklist field** to `ScheduleTask` in `types/index.ts` (after the `accessToken`-unrelated fields; near `linkedEstimateItems`):
```typescript
  /** Optional per-task checklist (sub-steps), e.g. Rebar / Formwork / Pour.
   *  Rendered in the mobile task-detail sheet; persisted with the task. */
  checklist?: { id: string; label: string; done: boolean }[];
```

- [ ] **Step 2: Thread `startDate` through `buildScheduleFromTasks`** (`utils/scheduleEngine.ts:271`). Add to the `opts` object and set it on the returned schedule, preserving an existing value (never reset to today on a rebuild):
  - Add to opts: `startDate?: string;`
  - Where the function builds the returned `ProjectSchedule`, ensure: `startDate: opts?.startDate ?? new Date().toISOString().slice(0, 10),` (only defaults to today when the caller didn't supply one). If the schedule object already assigns `startDate`, replace that line; if not, add the field to the returned object.

- [ ] **Step 3: Update the monolith callers to preserve startDate.** In `app/(tabs)/schedule/index.tsx`, every `buildScheduleFromTasks(scheduleName, ..., activeSchedule?.baseline)` call (lines ~426, 461, 507, 519, and any other) gains an opts arg preserving the current start: pass `{ startDate: activeSchedule?.startDate ?? selectedProject?.schedule?.startDate ?? new Date().toISOString().slice(0,10) }` merged with any existing opts (e.g. `criticalPathDays`). This makes mobile-built schedules anchor correctly and fixes the Summary dashboard Today/Week bug (`utils/summaryBriefing.ts`).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean. Then reason-check: `computeTodayTasks`/`computeWeekLoad` in `summaryBriefing.ts` use `schedule.startDate ?? createdAt`; after this, mobile-built schedules carry `startDate` → day-index correct.

- [ ] **Step 5: Commit** — `git add types/index.ts utils/scheduleEngine.ts "app/(tabs)/schedule/index.tsx" && git commit -m "fix(schedule): persist schedule.startDate (preserve on rebuild) + add ScheduleTask.checklist; fixes Summary day-math"`

---

## Task 2: Shell — MobileScheduleScreen + WeekStrip

**Files:** Create `components/schedule/mobile/MobileScheduleScreen.tsx`, `components/schedule/mobile/WeekStrip.tsx`

**Contract:**
```typescript
// MobileScheduleScreen — top-level mobile schedule. Owns: selected project,
// activeSchedule (from useProjects), selectedDate, active sub-tab, the
// TaskDetailSheet open-state, and the save helper.
interface MobileScheduleScreenProps { /* none — reads useProjects() like the current screen */ }
type SubTab = 'schedule' | '4d' | 'progress' | 'team';

// WeekStrip — horizontal SUN..SAT day pills for one week, selected highlighted.
interface WeekStripProps {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  weekStart?: Date; // defaults to the Sunday of selectedDate's week
}
```

- [ ] **Step 1: Build `WeekStrip`** — month label + 7 day pills (weekday abbrev + date number), selected pill = orange (`accent`) filled, today underlined; `onSelectDate`. Theme via `useThemedStyles`.
- [ ] **Step 2: Build `MobileScheduleScreen` shell** — header (project name + "▾" via existing project switcher pattern, location subtitle, bell → notifications-inbox, "•••" overflow → existing schedule menu/actions), `WeekStrip`, a sub-tab bar (`Schedule · 4D Model · Progress · Team`). Body switches on `SubTab`. Use `useProjects()` for `projects`/`updateProject`; derive `selectedProject`/`activeSchedule` like the current screen; add a `saveSchedule(next, project)` helper that calls `updateProject(project.id, { schedule: next })` (mirror `app/(tabs)/schedule/index.tsx:328`).
- [ ] **Step 3:** tsc clean. **Commit** — `git commit -m "feat(mobile-schedule): shell + WeekStrip"`

---

## Task 3: MobileGantt

**Files:** Create `components/schedule/mobile/MobileGantt.tsx`, `components/schedule/mobile/PhaseGroupRow.tsx`

**Contract:**
```typescript
interface MobileGanttProps {
  tasks: ScheduleTask[];          // activeSchedule.tasks
  startDate: string;              // activeSchedule.startDate
  selectedDate: Date;            // from WeekStrip → centers the timeline window
  onPressTask: (task: ScheduleTask) => void;
  onAddTask: () => void;          // opens AddTaskModal
}
```

- [ ] **Step 1: Build it** — group tasks by `phase` (collapsible `PhaseGroupRow` with phase name + rolled-up % = duration-weighted mean of children's `progress`). LEFT: fixed-width WBS column (phase header rows + child task rows: status icon ✓/◐/○ tinted by `getPhaseColor(phase)`, title). RIGHT: a horizontally-scrollable timeline — day/week header derived from `startDate`, one row per task aligned to the left list, a bar from `startDay`→`startDay+durationDays` colored `getPhaseColor` (critical `isCriticalPath` → danger red, `status==='done'` → 0.5 opacity + check), a vertical **today line**, dependency arrows for `dependencyLinks` (reuse `utils/ganttArrowPath.ts` `orthogonalArrowPath`). Tap a bar/row → `onPressTask`. A "+ New Work Package" row → `onAddTask`. Sync left/right vertical scroll. Keep it mobile-tuned (don't import the dense desktop `InteractiveGantt`).
- [ ] **Step 2:** tsc clean. **Commit** — `git commit -m "feat(mobile-schedule): MobileGantt (WBS phases + bars + deps + today line)"`

---

## Task 4: TaskDetailSheet + TaskChecklist

**Files:** Create `components/schedule/mobile/TaskDetailSheet.tsx`, `components/schedule/mobile/TaskChecklist.tsx`

**Contract:**
```typescript
interface TaskDetailSheetProps {
  visible: boolean;
  task: ScheduleTask | null;
  allTasks: ScheduleTask[];       // for dependency name lookup
  startDate: string;              // for date range
  onClose: () => void;
  onUpdateTask: (next: ScheduleTask) => void; // persists via parent saveSchedule
}
interface TaskChecklistProps {
  items: { id: string; label: string; done: boolean }[];
  onToggle: (id: string) => void;
  onAdd: (label: string) => void;
}
```

- [ ] **Step 1: Build `TaskDetailSheet`** — RN `Modal` bottom sheet. Header: phase-tinted icon tile + title + **% pill** + close. Tabs `Overview · Resources · Docs · Activity`.
  - Overview: Duration (date range from `startDate + startDay` → `+durationDays`, "N days"), Status (dropdown over the task statuses → `onUpdateTask`), Dependency (predecessor titles via `dependencyLinks` → `allTasks`), % Complete bar, then `TaskChecklist`, then a `FourDComingSoon`-style "4D preview — coming soon" block.
  - Resources: `crew` / `assignedSubName` / `crewSize`.
  - Docs: `linkedEstimateItems` count + a stub link to project docs.
  - Activity: recent status/progress notes (use `notes`; lightweight).
- [ ] **Step 2: Build `TaskChecklist`** — "N/M" header, rows with a check circle (toggle → `onToggle`), an add-row input (`onAdd`). Edits flow up via `onUpdateTask(next)` which writes `task.checklist`.
- [ ] **Step 3:** tsc clean. **Commit** — `git commit -m "feat(mobile-schedule): TaskDetailSheet + TaskChecklist"`

---

## Task 5: ProgressTab + TeamTab + FourDComingSoon

**Files:** Create `components/schedule/mobile/ProgressTab.tsx`, `TeamTab.tsx`, `FourDComingSoon.tsx`

- [ ] **Step 1: ProgressTab** — overall % (duration-weighted), per-phase progress bars, milestone list (`isMilestone`); optionally an earned-value glance via `utils/scheduleEarnedValue.ts` if cheap. Props: `{ tasks, startDate }`.
- [ ] **Step 2: TeamTab** — group tasks by `crew || assignedSubName || 'Unassigned'`; per group, the tasks + a count. Props: `{ tasks, onPressTask }`.
- [ ] **Step 3: FourDComingSoon** — centered icon + "4D model coming soon — link your BIM/3D model to watch the build play out over time." No renderer.
- [ ] **Step 4:** tsc clean. **Commit** — `git commit -m "feat(mobile-schedule): Progress + Team tabs + 4D placeholder"`

---

## Task 6: Wire into the schedule route (phone only)

**Files:** Modify `app/(tabs)/schedule/index.tsx` (entry only — render switch)

- [ ] **Step 1:** At the top of the schedule screen's render, branch: `const { isPhone } = useResponsiveLayout();` → `if (isPhone) return <MobileScheduleScreen />;` else fall through to the existing screen. (Keep the existing monolith intact for web/tablet; phones get the new experience. This is the minimal, reversible switch — no monolith refactor.)
- [ ] **Step 2:** tsc clean + grep: `grep -n "MobileScheduleScreen" "app/(tabs)/schedule/index.tsx"`.
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile-schedule): render MobileScheduleScreen on phones"`

---

## Self-Review
1. **Spec coverage:** shell+weekstrip+subtabs (T2) ✓, mobile gantt (T3) ✓, task sheet+checklist (T4) ✓, Progress/Team/4D (T5) ✓, checklist field + startDate fix (T1) ✓, phone wiring (T6) ✓, MAGE orange + theme tokens (all) ✓.
2. **Placeholders:** none — T1 full code; components have exact prop contracts + data sources + reuse points (getPhaseColor, orthogonalArrowPath, AddTaskModal, scheduleEarnedValue, updateProject).
3. **Consistency:** `SubTab` union, `saveSchedule(next, project)` signature, `onUpdateTask(next)`/`onPressTask(task)`/`onAddTask()` consistent across T2–T6; `checklist` shape matches T1's type.

## Whole-impl gates
- `npx tsc --noEmit` clean repo-wide.
- `git diff --stat`: `types/index.ts`, `utils/scheduleEngine.ts`, `app/(tabs)/schedule/index.tsx`, `components/schedule/mobile/*` (8 new), + the spec/plan docs.
- Manual (post-OTA, phone): reference-match; gantt phases/bars/deps/critical/today; tap→sheet; checklist persists; Progress/Team populate; 4D placeholder; mobile-built schedule → Summary Today/Week correct.
- App-only → rides an OTA when ready (confirm-gated ship).
