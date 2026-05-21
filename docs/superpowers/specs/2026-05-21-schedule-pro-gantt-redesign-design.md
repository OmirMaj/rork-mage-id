# 2026-05-21 — Schedule Pro Gantt Redesign

**Goal:** Rebuild the visual + selection-interaction layer of `components/schedule/InteractiveGantt.tsx` so the gantt reads as a clean PM-tool ("Procore + Linear" middle ground) instead of an animated tech-demo. Add a `double-click empty timeline → AddTaskModal pre-filled` entry point. **All existing CPM, drag, cross-platform, and adjacent-component behavior preserved unchanged.**

**Tech Stack:** Existing React Native / Expo Router 6 stack. `PanResponder` for cross-platform gestures (web + iOS + Android). `react-native-svg` for arrows. No new dependencies.

**Architecture:** Single-component refactor inside `InteractiveGantt`. Selection state newly lives in the component (or, optionally, lifted to parent — see §6). One small wire-up in `app/schedule-pro.tsx` to pass through the `prefillStartDay` prop to `AddTaskModal`.

---

## 1. Scope

### What's changing
- `components/schedule/InteractiveGantt.tsx` — visual rendering, selection state, arrow routing, double-click handler
- `app/schedule-pro.tsx` — small additive change to wire double-click → AddTaskModal with `prefillStartDay`
- `components/schedule/AddTaskModal.tsx` — accept optional `prefillStartDay` prop (additive; existing callers unaffected)

### What's explicitly NOT changing (every other component stays untouched)
CPM engine (`utils/cpm.ts`), `GridPane.tsx`, `SchedulerHeader.tsx`, `SchedulerTabShell.tsx`, `SchedulerContext.tsx`, `TaskInspector.tsx`, `BaselineManagerModal.tsx`, `ScenariosModal.tsx`, `AIAssistantPanel.tsx`, `EarnedValuePanel.tsx`, `LookaheadView.tsx`, `TodayView.tsx`, `SubUpdatesPanel.tsx`, `ResourceSwimlanes.tsx`, `ScheduleHealthScore.tsx`, `ScheduleShareSheet.tsx`, `ScheduleSettingsMenu.tsx`, `ExportSheet.tsx`, `WeatherReschedulePrompt.tsx`, `QuickBuildModal.tsx`, `ClosuresModal.tsx`, `VerticalGantt.tsx`, `GanttChart.tsx`, `StatusPill.tsx`, `SwipeableTaskCard.tsx`, `tabs/GanttTab.tsx`, `tabs/BoardTab.tsx`, `tabs/DashboardTab.tsx`, `tabs/ListTab.tsx`, `tabs/WorkloadTab.tsx`, `tabs/TabComingSoon.tsx`.

CPM result (`cpm.criticalPathIds`, `cpm.projectFinish`, etc.) consumed as today. Trade color logic (`utils/scheduleColors.ts colorForTask()`) consumed as today.

---

## 2. Visual changes — bar rendering

### 2.1 Bar fill
- **Flat solid color** per trade — no gradients. Colors sourced from existing `colorForTask(task)` helper, used as-is.
- Reference palette (consumed from `scheduleColors`, not hardcoded here): orange family for framing (`#c2410c`), blue for MEP (`#1e3a8a`), green for finishes (`#166534`), brown for excavation (`#78350f`), etc.
- `border-radius` / `rx`: **4** (square-ish; was pill-shaped).

### 2.2 Critical path indicator
- **Dark red outline** (`stroke: #7f1d1d`, `stroke-width: 1`) — bar keeps its trade-color fill.
- Replaces the prior red-fill treatment which lost trade context.

### 2.3 Done tasks
- Same trade color, `opacity: 0.5`.
- Task name in the left column gets `text-decoration: line-through` + `color: #9ca3af`.

### 2.4 Bar label
- Inline label format: `Task name · Nd` (e.g. "Foundation pour · 3d").
- Font: `600 11px ui-sans-serif`, color `#ffffff`.
- Line-height: 18 (bar height matches).
- Overflow: ellipsis with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
- For done tasks, append `✓` (e.g. "Foundation · 3d ✓").

### 2.5 Milestone diamonds
- Existing zero-duration milestone rendering preserved unchanged. Critical-milestone outline uses the new red stroke color (`#7f1d1d`).

---

## 3. Visual changes — selection state

### 3.1 Selection model
- **Click a bar → that bar becomes "selected"**. Click another bar → selection moves. Click empty timeline area → selection clears (unless that click is a double-click, see §5).
- Selection state held in `InteractiveGantt` local component state via `useState<string | null>(null)` keyed by `task.id`.
- Selection persists across drag operations (a bar stays selected through and after a drag).
- `Escape` key clears selection on web. Tapping outside the bar canvas on touch clears selection.

### 3.2 Selected-state visual decorations
1. **Dashed blue ring** outside the bar: `stroke: #2563eb`, `stroke-width: 1.5px`, `stroke-dasharray: "3 2"`, `rx: 6`. The ring is offset ~2px outside the bar on each side (4px taller / 4px wider total) so it doesn't visually overlap with the bar's own critical-path outline.
2. **Small circle handles** at left + right edges:
   - 8px diameter (4px radius)
   - `fill: #fff`, `stroke: #2563eb`, `stroke-width: 1.5px`
   - Centered vertically on the bar
   - Touch hitbox extends ~12px beyond the visible circle so they're tappable on mobile
3. **Dark tooltip** above the bar:
   - Background `#111827`, foreground `#fff`
   - Font `500 11px ui-sans-serif`
   - Padding `3px 8px`, `border-radius: 4px`
   - Content: `"<startDate> → <endDate> · <duration>d"` (e.g. "May 19 → May 26 · 6d")
   - Position: ~22px above the bar's top edge, horizontally centered on the bar (or left-aligned if the bar starts within 50px of the timeline's right edge to avoid clipping)
4. **Live updates during drag**: the tooltip text and handle positions update on every `PanResponder.onPanResponderMove` event using the same animated overlay pattern as today's drag-preview logic.

### 3.3 Selected row background
- The left-column row corresponding to the selected bar gets a tinted background `#eff6ff` and the task name in that row gets `color: #1e40af` + `font-weight: 600`.

---

## 4. Visual changes — dependency arrows

### 4.1 Visibility model
- **Hidden by default.** No arrows render when no task is selected.
- **Shown only for the selected task's direct predecessors + successors** (one-hop). Multi-hop chains are not drawn.
- This single change kills ~80% of the "always-on marching ants" visual noise.

### 4.2 Routing (orthogonal)
- Standard case: arrow leaves the **right edge of the predecessor bar** at the bar's mid-height. Steps right ~3px to clear the bar. Drops vertically to the successor bar's mid-height. Steps right to **land exactly on the successor's left edge**.
- **Overlap case** (successor's left edge is BEFORE the predecessor's right edge — start-to-start dependencies, finish-to-start with negative lag): arrow steps DOWN-AROUND the predecessor instead of through it. Specifically:
  1. Leaves predecessor's right edge
  2. Steps right ~3px
  3. Drops vertically PAST the predecessor row and into the row above/below the successor
  4. Steps left to a point ~3px before the successor's left edge
  5. Re-enters the successor row
  6. Lands on its left edge
- Routing util lives inside `InteractiveGantt` as a pure helper `function orthogonalArrowPath(from: {x, y}, to: {x, y}, options: {avoidOverlap: boolean}): string` returning an SVG path `d` attribute.

### 4.3 Arrow appearance
- **Stroke**: `#374151` (gray-700) for non-critical, `#b91c1c` (red-700) for critical-path arrows.
- **Width**: `1.25px`.
- **Endcaps**: `stroke-linecap: round`, `stroke-linejoin: round`.
- **Dashed**: `stroke-dasharray: 4 3`.
- **Arrowhead**: 5×5 SVG `<marker>` with `refX=5, refY=2.5`, polygon `"0 0, 5 2.5, 0 5"`, fill matching the stroke.

### 4.4 Animation — calm marching ants
- CSS animation: `stroke-dashoffset` from `0` to `-7` over `1.4s`, `linear`, `infinite`.
- Graceful degradation: `@media (prefers-reduced-motion: reduce) { animation: none; stroke-dasharray: none; }` — for vestibular accessibility, falls back to a solid line.

---

## 5. New interaction — double-click to add task

### 5.1 Empty timeline → AddTaskModal pre-filled
- Double-click anywhere in the timeline area that is NOT on an existing bar → opens `AddTaskModal`.
- The double-click's x-coordinate is converted to a day index using the existing `pxPerDay` zoom factor and the timeline's `startDate`.
- The resolved `startDay` is passed to `AddTaskModal` as a new optional prop `prefillStartDay: number`.
- Inside `AddTaskModal`, this prop pre-fills the start-day field if present; existing callers (toolbar Add Task button, etc.) pass nothing and behave unchanged.

### 5.2 Existing bar → TaskInspector
- Double-click any existing bar → opens `TaskInspector` (existing modal/sheet that today is reached via tap-and-hold on mobile and right-click on web).
- Single-click on bar = selection (as in §3). Double-click = TaskInspector. No race condition: single-click handler fires after a 250ms `setTimeout` that's cancelled if a second click lands within that window.

### 5.3 Touch parity
- Touch devices don't have native double-click. The equivalent on touch is **double-tap** (two taps within 300ms at roughly the same coordinate). React Native's `Pressable` exposes `onPress` + `onPressIn` events that we use to detect this.
- Long-press behavior on bars (existing TaskInspector trigger) is preserved as an alternate entry point.

---

## 6. Open question — selection state location

Two viable approaches:

**A. Selection state local to InteractiveGantt (default — chosen).**
- Simpler: no parent prop changes
- Selection survives only as long as InteractiveGantt is mounted
- If the user navigates to a different tab and back, selection resets — probably fine

**B. Selection state lifted to schedule-pro.**
- More work: new prop on InteractiveGantt + new piece of state in schedule-pro
- Survives tab navigation
- Enables other panels (TaskInspector, Sub Updates) to react to selection

**Default: A.** Lift later if a real cross-pane use case emerges. Document the choice in code comments.

---

## 7. Visual changes — timeline chrome

### 7.1 Weekend column shading
- For each Saturday + Sunday column in the timeline, render a subtle `#fafaf9` background fill spanning full row height.
- Implemented as an absolute-positioned `<View>` per weekend pair (or a single repeating background in CSS-on-web mode).
- Day-of-week labels in the header for weekends use `#d1d5db` (muted).

### 7.2 Today line
- Existing red vertical line is preserved.
- New: small `TODAY` pill label at the top of the line:
  - Position: top of the line, centered horizontally
  - Font: `700 9px ui-sans-serif`, color `#ef4444`
  - Background: white with 1px border `#fecaca`
  - Padding `2px 4px`, `border-radius: 3px`
  - Letter-spacing `0.08em`, uppercase
- The pill stays in view even when the user scrolls — it's positioned absolutely on the timeline canvas, not within a scrolling subregion.

### 7.3 Header date labels
- Week labels: `"Wk 3 · May 19"` format, `600 10px`, color `#9ca3af`, uppercase letter-spacing
- Day labels: single-letter `M T W T F S S`, `500 10px`, color `#6b7280` (weekday) / `#d1d5db` (weekend).

---

## 8. Drag behavior — what's preserved + what's added

### 8.1 Preserved (no change to existing PanResponder logic)
- Drag bar body → moves the task (`startDay` changes)
- Drag right edge → resizes (`durationDays` changes)
- Parent owns state. `onEdit(taskId, patch)` fires at drag-end with the final value.
- During drag, a local Animated.Value overlay updates the bar position for instant feedback.
- Cross-platform via `PanResponder` (web + iOS + Android).
- Cycle detection on dependency edits via `wouldCreateCycle()`.
- Drag-handle hitbox is wider than visible handle for thumb-friendliness on touch.

### 8.2 Added
- **Snap to day boundary** during drag — the live preview snaps to the nearest day rather than continuously sliding. Implementation: round `dx / pxPerDay` to nearest integer when computing the live overlay position.
- **Live tooltip update** — the date-range tooltip text updates on each `onPanResponderMove` event with the new `startDate` and `endDate`.
- **Handles only render on selected bar** (per §3.2), not on every bar — reduces visual clutter at rest.

---

## 9. What this audit/redesign explicitly does NOT include

Out of scope (worth doing later as separate sub-projects):
- Modifying `GridPane.tsx` (the spreadsheet view) — untouched
- New gantt features (e.g., baseline overlay rendering, resource histogram, what-if scenarios) — engine support exists, but renderer additions are separate work
- Auto-scroll-to-selected-bar when the user uses keyboard arrow keys
- Multi-select (shift-click to select multiple bars + bulk-drag) — could be a v2
- Drag dependency lines to create new dependencies (drag from a bar's edge to another bar) — major scope, separate spec
- Touch-and-hold-to-drag-to-reorder rows (changing row order via gantt itself) — separate spec
- Sidebar scroll-to-active when navigation changes (cross-cutting, separate)
- Performance refactor (the file is 2754 lines; could be split into sub-components, but the redesign doesn't require this)
- Accessibility audit beyond `prefers-reduced-motion` + existing accessibilityLabel coverage

---

## 10. Testing approach

- **Static**: `npx tsc --noEmit` clean repo-wide after each task
- **Visual**: manual verification via the running app (iOS Simulator, Android emulator, web)
- **Interaction**: manually walk:
  1. Click empty timeline area → no modal opens (single click)
  2. Double-click empty timeline area → AddTaskModal opens with that day's date in the start field
  3. Single-click a bar → bar selected (dashed ring + handles + tooltip + left-col row highlighted)
  4. Click another bar → selection moves
  5. Click empty area → selection clears
  6. Escape → selection clears (web)
  7. Drag a selected bar's body → moves, snaps to day, tooltip updates live
  8. Drag a selected bar's right edge → resizes, snaps, tooltip shows new end date
  9. Drag against the dependency (try to move a successor before its predecessor's end) → should respect existing CPM constraint behavior
  10. Double-click a bar → TaskInspector opens
  11. Critical-path arrow render — verify red color when bar is on critical path
  12. Overlap case — create a start-to-start dependency, verify arrow routes around (not through)
  13. `prefers-reduced-motion` toggle (macOS System Settings → Accessibility) — verify arrows go from animated to solid
- **Cross-platform**: walk the same checklist on iOS + Android + web

---

## 11. Implementation phases (rough)

1. **Phase 1 — Visual swap (no new behavior).**
   - Update bar rendering: flat colors, square-ish corners, label format, critical-path outline
   - Update arrow rendering: orthogonal routing helper, smaller arrowhead, dark stroke, hidden-by-default state
   - Update animation: calm 1.4s marching ants + reduced-motion guard
   - Update timeline chrome: weekend shading, today pill, header label format
   - Done tasks: opacity 0.5 + strikethrough in left column
   - Verify cross-platform render (no behavior changes — easy to roll back if anything looks wrong)
2. **Phase 2 — Selection state + decorations.**
   - Add `selectedTaskId` local state in InteractiveGantt
   - Render dashed ring + handles + tooltip when selected
   - Selected row background tint in left column
   - Escape / outside-tap to deselect
3. **Phase 3 — Snap to day + live tooltip update.**
   - Modify `PanResponder.onPanResponderMove` to round to day
   - Update tooltip text live during drag
4. **Phase 4 — Double-click handlers.**
   - Add `prefillStartDay?: number` prop to AddTaskModal
   - Wire double-click on empty timeline area → AddTaskModal with prefill
   - Wire double-click on existing bar → TaskInspector
   - Touch double-tap parity
5. **Phase 5 — Arrow routing edge cases.**
   - Implement `orthogonalArrowPath` with the overlap-avoidance rule
   - Verify critical-path arrow color
6. **Phase 6 — Polish + cross-platform QA.**
   - Walk the testing checklist on iOS / Android / web
   - Fix any platform-specific issues

Each phase is committable on its own — visual swap especially is a clean checkpoint where the redesign is "live" but no interactions have changed.

---

## 12. Risk + rollback

- **Risk**: SVG arrow rendering performance with many overlapping selected-bar-arrow chains. **Mitigation**: arrows only render for ONE selected task at a time (max 2 hops in/out = small N). Animation runs in CSS, GPU-accelerated.
- **Risk**: Drag tooltip lag during PanResponder updates. **Mitigation**: tooltip is a single styled `<View>` with text that updates via Animated.Value — same pattern as today's drag-preview.
- **Risk**: Selection state lost on tab navigation. **Mitigation**: deliberate (see §6); can be lifted later.
- **Risk**: Double-click empty area on touch — false positives from rapid scrolling. **Mitigation**: 300ms window + ~10px coordinate tolerance on the second tap. Cancel double-tap detection if a `PanResponder` claim occurs (i.e., the user is dragging, not double-tapping).
- **Rollback**: each phase is its own commit, all on top of `claude/p0-launch-on-main`. Revert any phase's commit if it misbehaves. The CPM + drag mechanics are untouched, so the underlying schedule data is never at risk.
