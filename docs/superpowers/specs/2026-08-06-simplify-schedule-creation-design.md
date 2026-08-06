# Simplify Schedule Creation (Design Spec)

_Date: 2026-08-06. From a two-part UX audit of schedule creation (normal + Pro stages). Goal: creating a schedule stops feeling complicated. Approved scope: all three parts._

## Problem (from the audit)

Creating a schedule fails the same way in both stages: **too many equally-weighted ways to start with no recommended path, and the authoring surface exposes CPM power-mechanics before the user has a working schedule.**

- **Normal:** the Schedule-tab empty state (`app/(tabs)/schedule/index.tsx:2511-2593`) shows **7 buttons** with no hierarchy — three are near-identical "AI" paths. The wizard then demands **4 decisions per task** (name, duration, phase, dependencies) via nested modals (`app/schedule-wizard.tsx` TasksStep ~1400-1650), and secretly seeds **Kitchen tasks** even on the "blank" path (`schedule-wizard.tsx:275-284`). The **Discover screen already does the front door right** (one hero + "OR" + secondary; `app/(tabs)/discover/schedule.tsx:345-395`) — the tab just diverges.
- **Pro:** Pro's `ScheduleOnRamp` (`components/schedule/ScheduleOnRamp.tsx`) is a good 5-path on-ramp, but its worst friction is **typed dependency syntax** (`T5FS+3`) in the grid Predecessors cell (`components/schedule/GridPane.tsx:723-760`) — silent failure, delete-and-retype to change a lag. A structured drag-to-link exists (`components/schedule/InteractiveGantt.tsx:595-620`) but is hidden.

**Two strong reuse levers:** (a) `ScheduleOnRamp` is already a shared component — make it the *single* "how to start" surface everywhere; (b) the wizard already has a good multi-predecessor picker with per-link type + lag (`schedule-wizard.tsx:1650-1800`, the PredecessorSheet) — reuse it in the Pro grid instead of typed syntax.

## Goal & exit condition

**A first-time user reaches a working schedule via one obvious path, and never has to type CPM syntax or make more than name+duration to add a task.** Power (dependencies, lag, phases, anchors) is available on demand, via pickers — never required up front, never typed.

## Part 1 — One front door (consistent, recommended, context-aware)

Make `components/schedule/ScheduleOnRamp.tsx` THE single "how to start a schedule" surface, rendered in all three mount points: the Schedule-tab empty state, the Discover schedule screen, and Pro's empty-schedule gate (`app/schedule-pro.tsx:1655-1676`, already uses it).

Redesign it to a **single recommended primary action + progressive disclosure**:
- **Recommended (one hero CTA), context-aware:**
  - Project has a `linkedEstimate` → **"Build from your estimate"** (one tap; moat-linked). This must route through the **AI-refined** generator, NOT the crude `qty/50` heuristic (`app/(tabs)/schedule/index.tsx:996`, `utils/autoScheduleFromEstimate.ts`) — retire the heuristic as the default path.
  - No estimate → **"Answer a few quick questions"** (the AI interview, `/schedule-builder` → `ScheduleBuilderInterview`), which scaffolds the input.
- **Secondary, always visible:** **"Start blank"** (`/schedule-wizard?scratch=1`) — and *blank means blank* (fix the hidden Kitchen seed at `schedule-wizard.tsx:275-284`: `scratch` must seed zero template tasks).
- **"More ways ▾" disclosure** (collapsed by default): Start from a template, Build by voice (only when eligible), Load an example, Add tasks manually.
- **Retire the redundant free-form "Generate with AI"** surfaced path (`index.tsx:2564`) — the Interview is the surfaced AI path; free-form's paragraph-in-one-shot is strictly worse and duplicative. (Keep the underlying generator; just stop surfacing a second AI entry.)

Copy: lead with what the action *does* ("Creates a schedule on this project — you add/adjust tasks inside it"), mirroring the Discover screen's already-good hints. One recommended path, clearly labeled; alternatives clearly secondary.

`ScheduleOnRamp` takes props for context (has-estimate, tier eligibility, persona) and callbacks per path, so the three mount points pass their own handlers. The Schedule-tab bespoke 7-button block and the Discover bespoke layout are both **deleted** in favor of mounting the shared component.

## Part 2 — Defer the wizard's per-task power mechanics

In the wizard `TasksStep` (`schedule-wizard.tsx` ~691, task row ~1400-1650): **adding/editing a task shows only Name + Duration by default.** Phase, dependencies, and lag move behind an optional, per-task **"Refine ▾"** disclosure on the row (collapsed). Nothing about phase/deps is required to add a task or advance.
- The existing PhasePickerSheet and PredecessorSheet stay — they just open from the "Refine" disclosure instead of being always-present chips.
- Surface **start day + time inline**, not on a later step: put the start-date/time control right in the Tasks step so the user sets it while adding tasks, never paging forward to reach the CPM anchor (audit finding #7). Keep the existing working-days explainer.
- **One-page wizard on wide screens (founder steer).** The mobile stepped flow stays as-is — the founder likes it. But a laptop wastes the horizontal space by making the user page forward just to set the date. So gate on the existing responsive hook (`utils/useResponsiveLayout.ts` `isDesktop`): at desktop width, present the SAME wizard as a **single two-pane page** — **left** = task list (name / duration / Refine controls) + the inline start day+time picker; **right** = the live timeline/Gantt preview updating as tasks and dates change. Everything needed to choose "what day, how long, the timeline" is visible and editable on one screen; on phones, keep the 4-step flow (Project → Tasks → Timeline → Review). This is a responsive presentation of the same wizard state/CPM/autosave — reuse the existing step components composed onto one page at desktop width, with the date control inlined rather than deferred.
- Preserve autosave/draft-restore and the `validate-schedule-wizard-ux.ts` contract (the dependency-sentence wording guards must stay green).

## Part 3 — Make Pro dependencies pickable (no typed syntax)

Replace the Pro grid's typed Predecessors cell (`components/schedule/GridPane.tsx:723-760`, column def ~90) with a **tap-to-open structured picker**:
- Extract the wizard's PredecessorSheet (`schedule-wizard.tsx:1650-1800`) into a shared `components/schedule/PredecessorPicker.tsx` (multi-select eligible earlier tasks + per-link type FS/SS/FF/SF + lag stepper, with cycle/self guards). Mount it from the grid cell tap and from the wizard's Refine disclosure (Part 2) — one picker, two call sites.
- The grid cell renders the human-readable summary ("Framing FS+3, Rough-in SS") read-only; **tapping it opens the picker**, not a text field. Lag is editable in the picker's stepper (no delete-and-retype).
- Keep the existing drag-to-link on the Gantt (`InteractiveGantt`) — it already produces the same `{taskId, type, lagDays}` shape; the picker writes the same structure, so CPM is unaffected.
- Keep raw-text entry available ONLY as a power-user affordance if trivial to retain (e.g. a "type instead" toggle), otherwise drop it — the picker is the primary and only required path.

## Non-goals / deferred
- No CPM/engine changes; no change to schedule *generation quality* (Part 1 only routes to the better existing generator).
- Anchors/constraints and resource-calendar discoverability (audit's intrinsic-complexity items) are a separate follow-up — not in this pass.
- No Gantt redesign; no new template content.

## Testing & ship discipline
- `bun run ship-check` green, including `test:schedule-wizard-ux` and the other schedule validators.
- Any pure decision logic (e.g. a `recommendedOnRampPath(ctx)` helper choosing estimate vs interview vs blank) ships as a pure util with a permanent `scripts/validate-*.ts` wired into ship-check.
- UX changes verified by reading + typecheck; where a simulator is available, drive the three front doors and the Pro grid picker and capture before/after.
- Keep app/server + mobile/desktop twins consistent (tab bar ↔ DesktopSidebar; the front door must work on iOS primary and web).

## Risks
- **Large files** (`schedule/index.tsx` ~2600, `schedule-wizard.tsx` ~2871, `schedule-pro.tsx`, `GridPane.tsx`) — high regression surface. Consolidating into `ScheduleOnRamp` reduces net complexity but the deletions must not drop a working path (e.g. voice/estimate eligibility conditions).
- **Extracting PredecessorPicker** must preserve the wizard's exact behavior + the `validate-schedule-wizard-ux.ts` wording contract; do it as a behavior-preserving extraction first, then mount in the grid.
- **Recommended-path logic** must handle every state (no project / no estimate / estimate present / tier-gated Pro / persona) and never dead-end.
- Removing the free-form AI entry and the qty/50 default changes existing behavior — confirm no other screen depends on them before deleting.
