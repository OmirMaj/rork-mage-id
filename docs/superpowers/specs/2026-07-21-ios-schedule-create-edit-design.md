# iOS Schedule Create + Edit (copilot-led) — Design

**Date:** 2026-07-21
**Status:** Approved (design); ready for implementation plan
**Branch target:** off `main` (currently `ac5745d`)

## Goal

Make creating **and** editing a construction schedule fast and clear on **iPhone** (the primary target per CLAUDE.md), and fix the "too many steps to reach an edit" problem on every surface. Every create/edit — spoken, tapped, or built — lands through one **reflow-preview → apply** flow so nothing is silent or buried.

## Background — current state (audited 2026-07-21)

- **AI Schedule Builder is desktop-only.** `app/schedule-pro.tsx` hard-bounces phones: `if (width < 900)` returns a "Best on a bigger screen" redirect (`schedule-pro.tsx:1456`) *before* the `ScheduleOnRamp` (with "Answer a few questions") renders (`:1491`). The classic mobile schedule (`app/(tabs)/schedule/index.tsx`) has **zero** references to `/schedule-builder`.
- **The `/schedule-builder` route + `ScheduleBuilderInterview` are already mobile-capable RN** (safe-area insets, single-column cards) and the full create → `schedule-review` → `updateProject` flow is verified. It is simply not wired to any mobile entry point.
- **Conversational schedule editing is desktop-only.** `scheduleEditCapability` + `ScheduleEditPanel` mount only in the desktop `ScheduleProScreen`. The classic mobile schedule persists edits via `updateProject`.
- **Reaching an edit takes too many steps.** To change an existing task's date on mobile you tap the task → detail modal → expand **Advanced** → "Start Day Override" (a raw day number, not a date) — 6–7 taps, and most users never find it. This is the core complaint: the *hunt to reach the edit*, not the date mechanics.
- **Changes are not shown "with logic."** Setting a `startDate` silently re-anchors the schedule (raw-day → calendar rebase); dependency cascades aren't previewed.

## Core pattern — one reflow preview for every change

Whether a change is **spoken** (copilot bar), **tapped** (quick-edit), or **built** (AI interview), it flows through the same pipeline, which already exists and is pure/validator-covered:

```
change → interpretScheduleOps (guards: cycle, bounds, ref-resolve)
       → runCpm (recalculate)
       → diffSchedule (finish delta, moved tasks, critical-path entered/left)
       → ScheduleDiffView preview  → Apply / Cancel
       → commit (persist)
```

The only surface-specific piece is **how the result is persisted**:
- **Desktop** `schedule-pro.tsx`: `commit(producer)` (existing).
- **Mobile** `app/(tabs)/schedule/index.tsx`: `updateProject(project.id, { schedule })` (existing path that tap-to-edit already uses).

This is injected through the existing `CopilotContext` seams `currentTasks` / `commitTasks`, so the `scheduleEdit` capability is unchanged across surfaces.

## What ships

### Part A — AI Schedule Builder on iPhone
Add the **"Answer a few questions (AI)"** entry into the classic mobile schedule's create/empty state, mirroring the desktop `ScheduleOnRamp` treatment (AI primary; templates / manual secondary). It navigates to the existing `/schedule-builder?projectId=…`.

- The interview + generation + `schedule-review` Accept → `updateProject` already work; verify safe-area/keyboard behavior on a physical-size phone and confirm `schedule-review`'s Accept returns cleanly to the classic mobile schedule (not the desktop scheduler).
- Keep the existing template + manual paths as secondary options.

### Part B — Always-there copilot bar (the "reach any edit in one tap" fix)
A pinned **"🎤 Tell me what to change"** voice/type bar on the schedule screen (mobile + desktop). Tap → speak or type a change ("push framing back a week", "demo starts March 3", "make cabinets 5 days") → `scheduleEdit` interprets → **reflow preview** → Apply.

- Mounts a `CopilotShell` with the `scheduleEdit` capability (the same shell the create-copilot uses on mobile).
- On mobile, `CopilotContext` is given `currentTasks` (read `project.schedule.tasks`) and `commitTasks` (apply via `updateProject`).
- Voice uses the existing STT path (already shipped); typing is the fallback.

### Part C — Streamlined tap-to-edit + real date pickers
Tapping a task surfaces the common edits **directly** — **Starts** (real `DatePickerModal`, no typed `YYYY-MM-DD`), **Duration**, **Status** — with no Advanced digging.

- A single-field change with **no ripple** applies instantly.
- A change that **cascades** (moves dependents or the finish date, incl. the first-time `startDate` rebase) shows the same compact **reflow preview** first, so the logic is visible and never silent.
- Replace the hand-typed `YYYY-MM-DD` inputs in `ScheduleSettingsMenu` (start date) and the mobile start-date modal with `DatePickerModal`.

## Architecture & files

**New (pure, React-free, validator-safe):**
- `utils/copilot/scheduleEdit/applyToProjectSchedule.ts` — `applyToProjectSchedule(schedule, editedTasks, cpmOptions) → ProjectSchedule` : recompute CPM and produce the next schedule object for `updateProject`. Pure; unit-tested.

**Modified:**
- `app/(tabs)/schedule/index.tsx` — (A) AI-builder entry in create/empty state; (B) mount the copilot bar (`CopilotShell` + `scheduleEdit`) and provide `currentTasks`/`commitTasks` wired to `updateProject` via `applyToProjectSchedule`; (C) surface Starts/Duration/Status in the task quick-edit with `DatePickerModal`, routing cascading changes through the reflow preview.
- `components/schedule/ScheduleSettingsMenu.tsx` — swap the typed start-date `TextInput` for `DatePickerModal`.
- `app/schedule-pro.tsx` — add the same pinned copilot bar to the desktop scheduler (it already has `commitTasks` via `commit()`); no other change.

**Reused unchanged:** `ScheduleBuilderInterview`, `/schedule-builder`, `scheduleEditCapability`, `interpretScheduleOps`, `diffSchedule`, `ScheduleDiffView`, `CopilotShell`, `DatePickerModal`, `runCpm`, `wouldCreateCycle`.

## Data flow (mobile edit example)

1. User taps the copilot bar → says "push framing back a week."
2. `scheduleEdit` grounding builds task context from `currentTasks` (project.schedule.tasks).
3. AI emits `EditOp[]`; `interpretScheduleOps` applies with guards → `editedTasks`.
4. `applyToProjectSchedule` runs `runCpm` → next schedule; `diffSchedule(old,new)` → diff.
5. `ScheduleDiffView` shows finish delta + moved tasks + critical changes → Apply.
6. `commitTasks` calls `updateProject(project.id, { schedule })` (offline-queue safe).

## Error handling

- Ambiguous / impossible edits (cycle, unknown task) → `interpretScheduleOps` returns per-op `OpResult`; surface a plain-language "couldn't apply: …" and keep the schedule unchanged.
- STT/AI failure → the copilot bar falls back to typing; the interview shows its existing error state with "Try again."
- Persist failure → `updateProject` goes through the offline queue (`supabaseWrite`), so a dropped connection is retried, not lost.

## Testing

- **Pure:** existing `validate-copilot-edit-ops` (20) + `validate-copilot-diff-schedule` (11) cover interpret/diff. **Add `validate-copilot-mobile-apply`** for `applyToProjectSchedule` (CPM recompute, schedule-shape preservation, no-op when tasks unchanged, cascade produces a non-empty diff).
- **Sim:** on the iPhone simulator (screenshots work), run the full loop — build a schedule via the interview → voice-edit ("demo starts later") → reflow preview → apply → confirm it persists; then a tap-to-edit date change with a cascade.
- OTA-safe (no native module, reuses `mageAI`); anti-slop lint (Colors/Type/Tokens); `bun run ship-check` green.

## Phasing (each independently shippable)

1. **A** — AI-builder entry on iOS.
2. **B** — copilot bar + mobile `commitTasks`/`applyToProjectSchedule`.
3. **C** — tap-to-edit quick-edit + `DatePickerModal` everywhere + cascade-preview.

## Out of scope

- Drag-to-move Gantt bars on desktop (nice-to-have; not required for the "reach the edit fast" goal).
- Unifying the mobile classic schedule and desktop `schedule-pro` state models (too large; the injected `commitTasks` seam avoids needing it).
- Sub-portal / role-content relevance changes.
