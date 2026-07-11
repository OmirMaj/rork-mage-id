# Pro Scheduler — "Microsoft Project, but modern & easier" (Design)

**Date:** 2026-07-10
**Status:** Approved (direction + nav model chosen) — increment 1 (A+B) → plan; increment 2 (C) → plan after.
**Surface:** Web/desktop Pro scheduler (`app/schedule-pro.tsx`, `components/schedule/*`), building on the merged-pending Phase 1 branch `claude/scheduler-front-door`.
**Constraint:** Presentation/UX + authoring gestures only. The CPM engine's *outputs* (`utils/cpm.ts` forward/backward passes, float) are not changed; we may *call* it and read `dependencyLinks`. OTA-safe (JS-only, `expo.version` stays `1.0.0`). Owner verifies visuals at merge (Claude can't render the >900px web screen).

---

## Reframe — what already exists (audit, 2026-07-10)

A grounded audit corrected the premise: **MAGE's Pro scheduler already ships most of Microsoft Project's signature surface.** The Timeline tab (`components/schedule/InteractiveGantt.tsx`) already draws dependency arrows (orthogonal routing via `utils/ganttArrowPath.ts`, arrowheads, **red critical path**, marching-ants animation on the active chain), supports **drag-to-link** with a cycle guard, and the CPM engine honors **FS/SS/FF/SF + lag** (`utils/cpm.ts`). It has timeline **zoom** (Day/Week/Month), a red **today line**, **milestone diamonds**, an editable **Predecessors column** that parses MSP notation like `2.1SS+2` (`components/schedule/GridPane.tsx`), and a WBS/summary **data model** (`utils/summaryRollup.ts`: `parentId`/`outlineLevel`/`isSummary`/`collapsed` + rollup).

So this is **polish + fill the authoring gaps**, not a rebuild. The three real problems:

1. **The lines look weak.** Arrow clearance is ~3px (they hug the bar), stroke is thin gray, and multiple predecessors converge on one point and stack into a blob.
2. **Three competing nav models.** The tab bar (6 tabs), the Timeline's own 5-mode layout switcher, and the toolbar `More` overflow don't reference each other; `List` even duplicates Timeline's `Grid` mode.
3. **You can't structure the plan.** The WBS model exists but there's no gesture to indent/outdent, reorder, or a context menu — so it reads like a *viewer*, not Project. The printed output is a plain 6-column table, not a Gantt.

---

## Workstreams

### A · Make the dependency lines read like MS Project

- **Arrow routing/weight (presentation, `utils/ganttArrowPath.ts` + `InteractiveGantt.tsx`):** widen `CLEARANCE` from ~3px to ~12px so links step out and turn cleanly instead of hugging the bar; land the arrowhead a few px left of the successor's edge; raise resting stroke ~1.25→1.5px with a slightly darker gray; **fan** converging arrowheads with a small per-index vertical offset so multiple predecessors into one task don't stack into a blob. Keep red critical-path emphasis and the animated active chain.
- **Link type/lag on create:** confirm during implementation whether the drag-to-link release already opens an FS/SS/FF/SF + lag popover (audit sources conflicted — one cited a popover at `InteractiveGantt.tsx:481-580`, another said drag creates a bare FS). If the popover exists, ensure it's discoverable and show the chosen type+lag as a small label on the arrow; if it doesn't, add a minimal inline picker (default FS) on release. Either way: **the arrow should visibly say its type/lag.**

*Out of scope for A (moves to a later mobile track): making drag-to-link work on iPhone — the link handle is currently hover/web-gated (`InteractiveGantt.tsx:2071`). This design targets the web/desktop Pro screen.*

### B · Plan / Track / Share grouped nav (chosen model)

Replace the three competing models with **one** desktop-menubar grammar — three words, each a dropdown of views + related actions. This is the literal "fewer top tabs, categories with things inside, taskbar-like" ask and it reads like a real app's File/Edit/View.

- **Plan ▾** — *build the schedule:* Timeline · List · Board — divider — Add task · Import · Re-plan (Reflow) · Closures.
- **Track ▾** — *monitor:* Overview · Workload · Calendar — divider — Critical path · Baseline · Weather re-plan · Health.
- **Share ▾** — *distribute:* Export · Share link · AI assist.
- **Always-visible** (too frequent to bury): the current view's name as context, `✦ AI`, `Add task`, `↶ ↷` Undo/Redo. The status verdict chip stays in the header.
- **Timeline layouts stay one click:** when Timeline is the active view, surface its modes (Grid · Split · Gantt · Lanes · Living Plan) as a small **secondary segmented control** in the `SchedulerHeader` row — the full set also lives in the Plan submenu.
- **Dedupe:** `List` becomes the canonical spreadsheet; drop `Grid` from the Timeline layout set (Split/Gantt/Lanes/Living remain) so there's one door per room.
- **The `More` overflow dissolves** into the three menus; the `BASELINE`/`VIEW` header pickers stay.
- **Mobile (keep coherent, not a redesign):** keep the existing bottom bar of the 3 most-used views (Timeline · Board · Overview) and rename its `⋯ More` to **Menu**, opening a full-screen sheet whose sections are literally **Plan / Track / Share** — same taxonomy as desktop. `AI`/`Add` stay as the header button + FAB.

Touches: `components/schedule/SchedulerTabShell.tsx` (the menubar + the mobile Menu sheet), `components/schedule/tabs/GanttTab.tsx` (layout switcher relocates to the header when Timeline active; drop Grid), `app/schedule-pro.tsx` (toolbar reduces; More dissolves), `components/schedule/SchedulerHeader.tsx` (hosts the contextual layout segmented control).

### C · The real MSP-parity additions (build after A+B)

Ranked by the audit as highest-leverage:

1. **Outline authoring** — `Tab`/`Shift+Tab` (and Indent/Outdent buttons) that set `parentId`/`outlineLevel`; **drag-to-reorder** grid rows; render summary rows as the classic MSP summary bar in the Gantt that rolls up its children. The data model + rollup already exist (`utils/summaryRollup.ts`) — this is the missing authoring UX. Must stay cycle/CPM-safe. Touches `GridPane.tsx` primarily.
2. **Row/bar context menu** — one popover/ActionSheet on both the grid row and the Gantt bar (right-click on web, 500ms long-press + haptic on native, resolving the existing long-press-vs-drag conflict): Insert above/below · Indent/Outdent · Add predecessor… · Convert to milestone · Mark complete · Delete. Each action is an undoable command. This becomes the umbrella that surfaces the outline + link-type + milestone actions in one MSP-familiar place.
3. **Printable fit-to-page Gantt one-pager** — replace the table-only AirPrint/PDF (`app/schedule-pro.tsx` print path) with an HTML/SVG Gantt: title block, timeline with bars, dependency arrows, milestone diamonds, red critical path, today line, legend — scaled to fit letter/tabloid landscape, reusing `InteractiveGantt`'s bar geometry. This is the artifact a GC actually hands to an owner/sub.

*Deferred (noted, not built now):* visual ripple-preview before commit; a consolidated Task-Information popover (overlaps `TaskInspector` — consolidate rather than add); iOS drag-to-link.

---

## Sequencing & rollout

- **Increment 1 = A + B** (dependency-line polish + Plan/Track/Share nav): the direct asks, lower risk, coherent. Own plan → subagent-driven build on `claude/scheduler-front-door`.
- **Increment 2 = C** (outline authoring + context menu + printable Gantt): bigger, `GridPane`-heavy. Own plan → build after increment 1 is reviewed.

Each increment ships on the branch, `ship-check` green, nothing merged/deployed without owner sign-off. Because these are visual web/desktop changes Claude can't render, the owner verifies at merge.

## Non-goals
- No change to CPM outputs, the offline queue, or persistence.
- No mobile scheduler redesign (only the coherent Plan/Track/Share Menu sheet on phone).
- No new native modules (OTA-safe).
