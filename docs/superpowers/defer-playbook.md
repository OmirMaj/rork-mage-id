# Defer Playbook — wanted features, deliberately sequenced later

A living list of features we **chose not to build yet** — not because they're bad, but because building them now would bloat scope, add risk, or fight features we're shipping first. Each entry says **what**, **why deferred**, **what unblocks it**, and **rough size**.

This is distinct from `docs/superpowers/audits/2026-05-21-session-followup-TODO.md`, which tracks audit/security findings. This file tracks **product features**.

> Rule of thumb for pulling something off this list: it gets built when (a) the thing it depends on has shipped and is stable, AND (b) it's the highest-leverage next thing for users. Don't build from this list just because it's here.

---

## Schedule Pro / Gantt

### G1 — Multi-select bars (shift-click + bulk move)
- **What:** Select multiple task bars (shift-click, or drag a lasso box), then move them all at once. "Push these 5 tasks +3 days."
- **Why deferred:** It's a second selection system layered on top of single-select. Needs: shift-click accumulation, marquee/lasso hit-testing, bulk-move math, and conflict handling when a group move violates a dependency. Roughly 3-4× the complexity of single-select.
- **Unblocked by:** The single-select + drag redesign (spec `2026-05-21-schedule-pro-gantt-redesign-design.md`) shipping and being stable.
- **Size:** Medium-large (own spec + plan). ~1 week.
- **Nothing lost meanwhile:** you can still move tasks one at a time.

### G2 — Drag-to-create-dependency (draw a line from one bar to another)
- **What:** Grab a connector dot on a bar's edge, drag to another bar, drop → creates an FS dependency between them.
- **Why deferred:** The single most complex gantt interaction, because it *fights* the move/resize gestures we're shipping. The app has to disambiguate "are you moving this bar, resizing it, or drawing a dependency?" — needs a dedicated connector handle + a drag mode + live cycle-detection feedback + snap-to-target + undo.
- **Unblocked by:** The redesign's selection + handle system shipping (we'll reuse the handle infrastructure).
- **Size:** Large (own spec + plan). ~1-2 weeks.
- **Nothing lost meanwhile:** dependencies are fully creatable TODAY via the Task Inspector and the spreadsheet grid (pick the predecessor task). This only adds a drag *shortcut*.

### G3 — Row reorder by dragging tasks up/down
- **What:** Drag a task bar (or its left-column row) vertically to change its display order.
- **Why deferred:** Vertical drag conflicts with the horizontal drag-to-reschedule we're shipping. Also, in a CPM schedule, order is usually derived from dates + dependencies, not manual position — so this is more a display preference than a scheduling action. Must also stay in sync with the spreadsheet (GridPane) row order.
- **Unblocked by:** Deciding whether row order is a stored display preference vs. derived. Needs a small data-model decision first.
- **Size:** Medium. ~3-4 days.
- **Nothing lost meanwhile:** task order today follows the natural schedule order.

### G4 — Baseline overlay rendering on the gantt
- **What:** Show the saved baseline bars as ghost bars behind the live bars, so slippage is visible at a glance.
- **Why deferred:** Engine support exists (`BaselineManagerModal` + baseline diff). The renderer addition is separate visual work not in the cleanup-redesign scope.
- **Unblocked by:** The redesign shipping (so we layer onto the new bar renderer, not the old one).
- **Size:** Medium. ~3 days.

### G5 — Resource histogram / workload strip under the gantt
- **What:** A horizontal strip showing crew/resource load per day, highlighting over-allocation.
- **Why deferred:** `ResourceSwimlanes` + resource leveling exist in the engine; the gantt-integrated histogram view is a separate render surface.
- **Unblocked by:** Redesign shipping.
- **Size:** Medium-large. ~1 week.

---

## How the current redesign relates

The shipping redesign (`2026-05-21-schedule-pro-gantt-redesign-design.md`) deliberately builds the **foundation** that several of these sit on:
- Single-select + handle system → reused by G1 (multi-select) and G2 (drag-to-create-dep)
- New flat-bar renderer → reused by G4 (baseline overlay) and G5 (resource histogram)

So shipping the clean redesign first isn't just "the thing you asked for" — it's also the right *architectural* order. Each deferred feature gets cheaper to build once the foundation is solid.

---

## Cross-reference

- `docs/superpowers/audits/2026-05-21-session-followup-TODO.md` — audit/security deferrals (CRON_SECRET fix, DB-side state machine, AsyncStorage zod layer, Stripe web checkout, etc.)
- `docs/workflow-audit-roadmap.md` — the broader app-wide UX pattern roadmap (StatusPipeline, carry-forward, etc.)
