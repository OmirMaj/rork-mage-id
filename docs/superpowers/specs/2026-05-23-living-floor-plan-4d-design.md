# Living Floor Plan — lightweight "4D" without 3D uploads (Design)

**Date:** 2026-05-23
**Status:** Approved (design) — ready for implementation plan
**Scope of THIS spec:** Phase ① (the Living Floor Plan). Phase ③ (AI auto-progress) is designed at a high level here but gets its **own** spec/plan after ① ships.

## Goal

Give SMB GCs the *value* of 4D BIM — watching the building progress through space over time — **without** uploading or maintaining a heavy 3D model. Reframe: contractors already capture a **2D floor plan, progress photos, and a schedule**. Build "4D" from those. It shows the *real* building (actual photos), not an idealized render, and carries **zero modeling burden**. Flagship, client-facing differentiator.

## Architecture (all 2D → OTA-safe, web + iOS, no native 3D renderer)

The floor-plan image is the canvas. The GC draws rectangular **zones** (rooms/areas), links each to the schedule work that happens there, and a **timeline scrubber** animates the plan across the project dates: zones tint by status as-of the scrubbed date; tapping a zone shows the real photos from that period.

Everything renders with React Native primitives + SVG over the plan image (absolutely-positioned rectangles). No `expo-gl`, no WebView, no native modules → ships via OTA on both iOS and web.

### Data model

New type in `types/index.ts`:

```ts
export interface PlanZone {
  id: string;
  projectId: string;
  planSheetId: string;       // which PlanSheet this zone is drawn on
  // Rectangle in NORMALIZED plan coords (0–1 of the plan image w/h), so it
  // scales to any render size and is resolution-independent.
  x: number; y: number; w: number; h: number;
  label: string;             // "Kitchen", "Master Bath"
  linkedTaskIds: string[];   // schedule task ids whose work happens in this zone
  color?: string;            // optional override; default derives from active trade
  createdAt: string;
  updatedAt: string;
}
```

### Persistence (mirror `DrawingPin` exactly — no migration, OTA-safe)

Add a project sub-collection following the established `tertiary_*` pattern in `contexts/ProjectContext.tsx`:
- Key: `tertiary_plan_zones` (alongside `tertiary_drawing_pins`, `tertiary_plan_sheets`).
- State: `planZones: PlanZone[]` + `persistPlanZones` (same offline-first path `DrawingPin` uses).
- Methods: `addPlanZone`, `updatePlanZone`, `deletePlanZone`, `getPlanZonesForPlan(planSheetId)`, `getPlanZonesForProject(projectId)`.

This requires **no Supabase migration** for v1 (it mirrors drawing pins' storage). If pins sync to Supabase, zones follow the identical path.

## The zone ↔ schedule model (the key decision)

A room is **not** one task — it moves through framing → MEP → drywall → paint over time. So a zone links to **the tasks that happen in it** (`linkedTaskIds`). At any scrubbed date `D`, the zone reflects the currently-active trade:

Given `baseMs = schedule.startDate`, and each linked task's `startDay`/`durationDays`:
- A task is **done** if its end day ≤ `D`, **in-progress** if `start ≤ D < end`, **not-started** if `start > D`.
- **Zone status @ D:**
  - If any linked task is in-progress at `D` → status = that task's phase, **planned %** = `clamp((D − taskStart) / taskDuration, 0, 1)` (if several, the latest-starting in-progress task wins — the "current" trade).
  - Else if at least one linked task is done by `D` and none in-progress → **done** (whatever the last completed trade was).
  - Else → **not-started**.
- **Color:** `getPhaseColor(activeTask.phase)`; fill opacity scales with planned %; **done** = solid fill; **not-started** = dashed outline only; a zone with **no linked tasks** = neutral dashed outline (prompt to link).

The scrubber shows the **planned** animation (derived purely from task dates — no historical data needed). Tapping a zone surfaces the **actual** photos + the linked task's actual `progress`. (Plan-vs-actual variance coloring is Phase ③.)

### Photo → zone mapping (reuse existing pins)

A photo "belongs" to a zone when it has a `DrawingPin` on the **same** `planSheetId` whose `(x, y)` falls inside the zone rectangle (pins already carry `linkedPhotoId`). Implementation note: compare the pin `(x, y)` and the zone rect in the **same coordinate space** — the zone rect is normalized (0–1); if `DrawingPin.x/y` are stored in plan **pixels**, normalize them via `PlanSheet.width/height` before the point-in-rect test (the plan/pin viewer's existing convention is the source of truth — match it). Zone tap → those photos, filtered to `createdAt ≤ scrubber date`, newest first. No new photo plumbing.

## Components (small, focused units)

- **`PlanZoneEditor`** — edit mode over the plan image: tap-drag to draw a rectangle, name it, link schedule task(s) (a task picker reusing the schedule), edit/delete existing zones. Writes via `addPlanZone`/`updatePlanZone`/`deletePlanZone`.
- **`LivingFloorPlan`** — the main view: renders the `PlanSheet` image, the zone rectangles tinted by status @ scrubber date, the `TimelineScrubber`, and an `[Edit]` affordance (hidden in portal/read-only). Tapping a zone opens the zone sheet.
- **`TimelineScrubber`** — a date slider across `[schedule.startDate, projectFinish]` built on RN `PanResponder` (OTA-safe, like the existing `PercentSlider`); shows the scrubbed date + a "Today" marker; snaps to days.
- **Zone sheet** — bottom sheet: zone name, the active/linked task(s) + actual %, and a horizontal strip of the real photos in that zone (≤ scrubbed date). Reuses the existing bottom-sheet + photo patterns.

## Where it lives

- **Mobile:** the **"4D Model" sub-tab** in the mobile schedule (replaces `FourDComingSoon`) renders `LivingFloorPlan`. If the project has no plan sheet, show an empty-state prompting "Add a floor plan" (links to the existing plan-sheet upload).
- **Web:** a "Living Plan" view in the desktop Schedule Pro.
- **Client portal:** a **read-only** `LivingFloorPlan` (scrub + tap to view photos; no edit) — *"watch your home get built on the blueprint."*

## Reuse

`PlanSheet` (image + pixel dims), `DrawingPin` + photos (zone photo anchors), the schedule (`ScheduleTask` dates/phases, `getPhaseColor`, `runCpm.projectFinish` for the timeline end), `useThemedStyles`/`ThemeColors`/`Tokens`, `PanResponder`, `expo-haptics`. No new dependencies.

## Edge cases & error handling

- **No plan sheet for the project** → empty state with a CTA to upload one (don't crash).
- **No schedule / no tasks** → render the plan with zones as neutral outlines; scrubber hidden or disabled.
- **Zone with no `linkedTaskIds`** → neutral dashed outline + "link tasks" hint; excluded from status animation.
- **Plan revision change** (a `PlanSheet` replaced with a new revision) → zones are tied to a specific `planSheetId`; on a new revision they do **not** auto-migrate. v1: if the new revision has matching pixel dims, offer "copy zones from previous revision"; otherwise the user re-draws. (Normalized coords make same-dim copy safe.)
- **Multi-sheet projects** → v1 is per-plan-sheet; a sheet picker selects which plan to view. (Multi-floor stacking is out of scope.)
- **Normalized-coord rendering** → all zone math uses the rendered image's measured size; clamp zones to `[0,1]`.

## Testing & gates

Per `CLAUDE.md` there is no unit-test runner; the gate is **`npx tsc --noEmit` clean** (strict, no `any`) + a manual walkthrough. Theme-aware (light + dark), iOS-primary + web. Each task in the plan ends with the tsc gate.

## Out of scope (v1)

- **Phase ③ — AI auto-progress** (separate spec): AI vision reads the photos pinned in each zone, estimates the real stage/%, and updates the zone's *actual* status so the plan self-updates and plan-vs-actual variance shows (zone outlined red if behind). Built on the existing `analyze-photos` pipeline.
- Polygon/free-form zones (v1 = rectangles).
- AI room auto-detection from the plan image.
- 3D massing / any 3D.
- Multi-floor 3D stacking.

## Phasing

1. **Phase ① (this spec):** PlanZone model + persistence, `PlanZoneEditor`, `LivingFloorPlan` + `TimelineScrubber`, planned status coloring, zone photo strip, wire into the 4D tab (mobile) + web + read-only portal.
2. **Phase ③ (next spec):** AI auto-progress on top of ①.
