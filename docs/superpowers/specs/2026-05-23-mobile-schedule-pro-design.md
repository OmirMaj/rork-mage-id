# Mobile "Schedule Pro" — iOS-native schedule experience

**Date:** 2026-05-23
**Status:** Approved direction (user reference screenshot + 4D = coming-soon placeholder)
**Visual target:** user-supplied reference (two iPhones): a polished mobile gantt + a rich task-detail sheet. Adapt to MAGE's **orange** accent (reference is purple).

## Goal

Replace the cluttered 3,607-line mobile schedule monolith (`app/(tabs)/schedule/index.tsx`) with a cohesive, touch-first "Schedule Pro" for iOS that matches the reference: a clean mobile gantt + rich task detail + sub-tabs — keeping the Pro power (phases, dependencies, critical path, progress, crew) but presented mobile-natively.

## Approved decisions
- Match the reference layout/feel; MAGE **orange** theme (not purple).
- **4D Model** tab = a tasteful **"coming soon"** placeholder. A real 4D BIM viewer (3D/IFC model × time) is out of scope — no model source in-app; revisit as its own project.
- Fold in the audit's day-math fix: `buildScheduleFromTasks` must set `schedule.startDate` (today) — currently it doesn't, which also makes the new Summary dashboard's Today/Week wrong for mobile-built schedules.

## Design

### Shell (matches reference, left phone)
- **Header:** project name + "▾" project switcher, location subtitle, notification bell, "•••" overflow.
- **Week-strip date selector:** horizontal SUN–SAT day pills with the month, selected day highlighted; drives the gantt's visible window / today focus.
- **Sub-tabs:** `Schedule` · `4D Model` (coming-soon) · `Progress` · `Team`.

### Schedule tab — mobile gantt
- **Left:** WBS-grouped **phase rows** (e.g. "01 Structure 60%", collapsible) → child task rows (✓ done / ◐ in-progress / ○ not-started icons, phase-tinted).
- **Right:** horizontally-scrollable gantt — week/day headers, **phase-colored bars**, **dependency arrows** (FS/SS/FF/SF), critical = red, done = lighter/checked, a **today line**.
- Reuse the schedule engine + the desktop gantt's concepts (`utils/scheduleEngine.ts`, `ScheduleTask`, `dependencyLinks`, `isCriticalPath`, `progress`, `getPhaseColor`). Render mobile-tuned (a focused `MobileGantt`, not the dense desktop `InteractiveGantt`).
- **"+ New Work Package"** (= add task, reuse `AddTaskModal`). Tap a bar/row → **task-detail sheet**.

### Task-detail sheet (matches reference, right phone)
- Header: phase icon tile + task title + phase label + **% pill** + close.
- Tabs: **Overview · Resources · Docs · Activity**.
  - **Overview:** Duration (date range + "N days"), Status (editable dropdown), Dependency (predecessor name) / Depends-On, **% Complete** bar.
  - **Resources:** assigned crew / sub (`crew`, `assignedSubName`), crew size.
  - **Docs:** linked docs / estimate items (`linkedEstimateItems`, project documents).
  - **Activity:** recent updates (sub-updates / status changes).
- **Checklist:** per-task checklist ("3/5", Rebar ✓ / Formwork ✓ / Concrete ◐ …) with tap-to-toggle. 4D preview block → "coming soon" placeholder (not the 3D render).

### Progress tab
- Overall % + per-phase progress bars + milestone list; optional cash/earned-value glance (reuse `utils/scheduleEarnedValue.ts`). Keep it glanceable.

### Team tab
- Tasks grouped by crew/assignee; who's on what this week.

### 4D Model tab
- Clean placeholder: icon + "4D model coming soon — link your BIM/3D model to see the build play out over time." (No renderer.)

## Data / engine changes
- **NEW** field on `ScheduleTask` (`types/index.ts`): `checklist?: { id: string; label: string; done: boolean }[]`.
- **FIX** `utils/scheduleEngine.ts` `buildScheduleFromTasks`: set `startDate` to today (yyyy-mm-dd) so mobile-built schedules anchor correctly (also fixes Summary dashboard `summaryBriefing.ts` Today/Week). Keep `schedule-pro.tsx`'s existing default behavior consistent.
- Everything else reads existing fields; **no backend/migration** — OTA-able.

## File structure (build clean alongside; don't bloat the monolith)
- `components/schedule/mobile/MobileScheduleScreen.tsx` — shell (header + week strip + sub-tabs), composes the tabs.
- `components/schedule/mobile/MobileGantt.tsx` — the WBS list + scrollable phase-colored bars + dep arrows + today line.
- `components/schedule/mobile/TaskDetailSheet.tsx` — the Overview/Resources/Docs/Activity + checklist sheet.
- `components/schedule/mobile/WeekStrip.tsx`, `PhaseGroupRow.tsx`, `TaskChecklist.tsx`, `ProgressTab.tsx`, `TeamTab.tsx`, `FourDComingSoon.tsx`.
- Wire into `app/(tabs)/schedule/` (the mobile route) — render `MobileScheduleScreen` on phones; keep the desktop/web `schedule-pro.tsx` for wide screens. Reuse `AddTaskModal`, `TaskInspector` patterns, `scheduleEngine`, theme tokens.

## Scope / constraints
- iOS-primary (phones); web keeps the desktop Schedule Pro. Strict TS, no `any`. MAGE orange theme (light + dark). No new native dep, no backend, no migration → **OTA-able**.
- **Out:** real 4D BIM viewer; a full rewrite of every monolith feature in one pass (port the high-value views; the monolith can be retired incrementally).

## Deferred
- Real 4D BIM viewer (own project; needs model format/source decision).
- Drag-to-reschedule / drag-to-create-dependency on the mobile gantt (gesture-heavy; see defer-playbook G2/G3) — start read + tap-detail; editing via the sheet + AddTaskModal.

## Verification
- `npx tsc --noEmit` clean. Visual match to the reference (orange-themed). Gantt renders phases/bars/deps/critical/today; tap → sheet; checklist toggles + persists; Progress/Team tabs populate; 4D placeholder shows. `startDate` fix verified: a mobile-built schedule yields correct Summary Today/Week.
- App-only → rides an OTA when ready.
