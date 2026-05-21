# Schedule Pro Gantt Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `components/schedule/InteractiveGantt.tsx` to the clean flat-bar + orthogonal-arrow + selection-decoration design from the spec, and add double-click-to-add-task — without changing the CPM engine, drag mechanics, or any adjacent component.

**Architecture:** This is a **restyle of an existing 2754-line component**, not a rebuild. Selection state already exists as the parent-owned `focusedTaskId`/`onFocusTask` props (wired in `app/schedule-pro.tsx:722,1380-1381`). The plan reuses that — it does NOT add new selection state. New behavior is additive: an orthogonal arrow-path helper, selection decorations on the focused bar, a `defaultStartDay` prop on `AddTaskModal`, and a double-click handler on the timeline background.

**Tech Stack:** React Native / Expo Router 6, TypeScript strict, `PanResponder` (cross-platform gestures), `react-native-svg` (arrows). No new dependencies. **No test runner exists in this repo** — the per-task gate is `npx tsc --noEmit` clean at the worktree root PLUS the manual visual-verification checklist (spec §10). Pure logic helpers get a standalone Node smoke-test where noted.

**Spec:** `docs/superpowers/specs/2026-05-21-schedule-pro-gantt-redesign-design.md`

**Critical constraint:** Per-task additive. ONLY modify the 3 files in the ledger below. Do NOT touch the CPM engine, GridPane, other modals/panels/tabs, or scheduleColors.

**File ledger (the ONLY files this plan changes):**
- `components/schedule/InteractiveGantt.tsx` — bars, arrows, selection decorations, today pill, weekend shading, double-click on background
- `components/schedule/AddTaskModal.tsx` — add optional `defaultStartDay?: number` prop (additive; existing callers unaffected)
- `app/schedule-pro.tsx` — wire double-click → AddTaskModal with the resolved start day

---

## Pre-flight (read before Task 1)

The implementer MUST read these before touching code, to hold the relevant sections in context:

1. `components/schedule/InteractiveGantt.tsx` in full — it's 2754 lines. Key anchors:
   - L59 `colorForTask(task)` — trade color source (consume, don't change)
   - L71-106 `InteractiveGanttProps` — note `focusedTaskId`/`onFocusTask` already exist
   - L112-115 layout constants: `ROW_HEIGHT=56`, `BAR_HEIGHT=26`, `BAR_VERTICAL_PADDING`, `HEADER_HEIGHT=56`
   - L192-201 `pxPerDay` state + `zoom` derivation
   - L287-303 bar-geometry useMemo (computes x/y/width per bar)
   - L392 `Math.round(dx / pxPerDay)` — **snap-to-day already exists** in the drag logic
   - L571 `PanResponder.create` — drag move/resize gesture (do NOT rewrite; only read)
   - L680-697 existing arrow/marker rendering (this is what we replace)
   - L763-810 today marker + grid lines
   - L984 `colorForTask(t)` in the bar render loop
   - the `makeStyles` StyleSheet (search `const makeStyles`)
2. `components/schedule/AddTaskModal.tsx` L43-52 `AddTaskModalProps` + the `onCreate` shape (`NewTaskValues`)
3. `app/schedule-pro.tsx` L576 `handleAddTask`, L722 `focusedTaskId` state, L1377-1381 InteractiveGantt usage, L1545 AddTaskModal usage

**Why this matters:** the bar geometry, drag math, and focus plumbing already exist and work. This plan changes how things LOOK and adds the double-click entry point — it must not regress the existing drag, focus, or CPM behavior.

---

## Task 1: Orthogonal arrow-path helper (pure function, unit-smoke-tested)

The one piece of genuinely new pure logic. Isolating it first means the rest of the arrow work is just calling it.

**Files:**
- Create: `utils/ganttArrowPath.ts`
- Smoke test: `utils/ganttArrowPath.smoke.ts` (a standalone Node script — delete after verifying, since there's no test runner)

- [ ] **Step 1: Write the helper**

Create `utils/ganttArrowPath.ts`:

```ts
// ganttArrowPath — orthogonal (right-angled) dependency arrow routing for the
// gantt. Returns an SVG path `d` string from a predecessor bar's right edge to
// a successor bar's left edge using only horizontal + vertical segments.
//
// Standard case: right of predecessor → step right → drop vertically →
// land on successor's left edge.
//
// Overlap case (successor.leftX <= predecessor.rightX, i.e. start-to-start or
// finish-to-start-with-negative-lag): route AROUND, not through. We exit the
// predecessor's right edge, step right a clearance gap, drop to a mid-gutter
// between the two rows, run left to just before the successor's left edge,
// then drop into the successor row and land on its left edge.

export interface ArrowPoint {
  x: number;
  y: number;
}

/** Horizontal clearance (px) the arrow steps out before turning. */
const CLEARANCE = 3;

/**
 * @param from  predecessor bar's right-edge midpoint {x, y}
 * @param to    successor bar's left-edge midpoint {x, y}
 * @returns SVG path `d` attribute
 */
export function orthogonalArrowPath(from: ArrowPoint, to: ArrowPoint): string {
  const standard = to.x >= from.x + CLEARANCE;
  if (standard) {
    // exit → step right → drop → land
    const turnX = from.x + CLEARANCE;
    return `M ${from.x} ${from.y} L ${turnX} ${from.y} L ${turnX} ${to.y} L ${to.x} ${to.y}`;
  }
  // Overlap: route around. Mid-gutter is halfway between the two row centers.
  const midY = (from.y + to.y) / 2;
  const outX = from.x + CLEARANCE;
  const backX = to.x - CLEARANCE;
  return [
    `M ${from.x} ${from.y}`,
    `L ${outX} ${from.y}`,
    `L ${outX} ${midY}`,
    `L ${backX} ${midY}`,
    `L ${backX} ${to.y}`,
    `L ${to.x} ${to.y}`,
  ].join(' ');
}
```

- [ ] **Step 2: Write the smoke test**

Create `utils/ganttArrowPath.smoke.ts`:

```ts
import { orthogonalArrowPath } from './ganttArrowPath';

// Standard: successor to the right + below
const a = orthogonalArrowPath({ x: 100, y: 25 }, { x: 200, y: 75 });
console.assert(a === 'M 100 25 L 103 25 L 103 75 L 200 75', `standard wrong: ${a}`);

// Overlap: successor's left edge is BEFORE predecessor's right edge
const b = orthogonalArrowPath({ x: 200, y: 25 }, { x: 150, y: 75 });
console.assert(b.startsWith('M 200 25'), `overlap start wrong: ${b}`);
console.assert(b.includes('L 203 50'), `overlap mid-gutter wrong: ${b}`); // midY=50, outX=203
console.assert(b.endsWith('L 150 75'), `overlap end wrong: ${b}`);

console.log('ganttArrowPath smoke: PASS');
```

- [ ] **Step 3: Run the smoke test**

Run: `npx tsx utils/ganttArrowPath.smoke.ts` (or `npx ts-node` if tsx unavailable)
Expected: `ganttArrowPath smoke: PASS` with no assertion errors.

- [ ] **Step 4: tsc gate**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 5: Delete the smoke test + commit**

```bash
rm utils/ganttArrowPath.smoke.ts
git add utils/ganttArrowPath.ts
git commit -m "feat(gantt): orthogonal arrow-path helper with overlap routing"
```

(We delete the smoke test because the repo has no test runner to keep it green in CI; the assertions served their one-time verification purpose. If a runner is added later, restore it as a proper test.)

---

## Task 2: Flat bar restyle (color, corners, label, critical outline, done state)

**Files:**
- Modify: `components/schedule/InteractiveGantt.tsx` — the bar render loop (around L984) + `makeStyles`

- [ ] **Step 1: Locate the bar render**

Read the bar-rendering JSX (the `tasks.map(...)` or bar loop near L984 where `colorForTask(t)` is called). Identify the `<View>`/`<Rect>` that draws each bar and the `<Text>` that labels it.

- [ ] **Step 2: Apply flat fill + square corners + critical outline**

Transform each bar element so that:
- Background = `colorForTask(t)` (already the case — keep it; just ensure no gradient wrapper)
- `borderRadius: 4` (was pill-shaped / larger)
- When `cpm.criticalPathIds.includes(t.id)` (verify the exact field name in `CpmResult` — it may be `criticalPath`, `criticalIds`, or similar; grep `cpm.` usages): add `borderWidth: 1, borderColor: '#7f1d1d'`. Do NOT change the fill color for critical tasks.
- When the task is complete (verify the done-detection — likely `t.progress >= 100` or `t.status === 'done'`; grep existing usages): `opacity: 0.5`.

Exact values to use (from spec §2):
```ts
// in makeStyles or inline style:
bar: {
  borderRadius: 4,
  height: BAR_HEIGHT,
  justifyContent: 'center',
  paddingHorizontal: 6,
  overflow: 'hidden',
},
barCritical: { borderWidth: 1, borderColor: '#7f1d1d' },
barDone: { opacity: 0.5 },
```

- [ ] **Step 3: Bar label format**

Change the bar's `<Text>` to render `${t.name} · ${durationDays}d` (append ` ✓` when done). Style:
```ts
barLabel: {
  color: '#FFFFFF',
  fontSize: 11,
  fontWeight: '600',
},
```
Add `numberOfLines={1}` and `ellipsizeMode="tail"` to the `<Text>` so short bars truncate cleanly.

Compute `durationDays` from the same source the geometry uses (the bar-geometry useMemo at L287-303 already has duration — reuse it; do not recompute differently).

- [ ] **Step 4: tsc gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual verify**

Start the app on web (`bun run start-web`) or simulator, open a project's Schedule → Gantt. Confirm: bars are flat solid trade colors, square-ish corners, label reads "Name · Nd", critical-path tasks have a thin dark-red outline (not red fill), completed tasks are dimmed. No console errors.

- [ ] **Step 6: Commit**

```bash
git add components/schedule/InteractiveGantt.tsx
git commit -m "feat(gantt): flat bar restyle — solid color, square corners, name+days label, crit outline"
```

---

## Task 3: Arrow restyle — orthogonal routing, smaller head, hidden-unless-focused

**Files:**
- Modify: `components/schedule/InteractiveGantt.tsx` — the arrow/marker rendering (L680-697 area) + import the Task 1 helper

- [ ] **Step 1: Import the helper**

At the top of `InteractiveGantt.tsx` add:
```ts
import { orthogonalArrowPath } from '@/utils/ganttArrowPath';
```

- [ ] **Step 2: Gate arrow visibility on focus**

Find where dependency arrows are computed/rendered. Change the set of arrows drawn so that ONLY arrows touching `focusedTaskId` render:
- If `focusedTaskId == null` → render NO arrows.
- Else → render arrows where `from === focusedTaskId` OR `to === focusedTaskId` (one hop in + out).

Build the list from the same dependency source the component already uses (grep `dependencyLinks` / `dependencies` in the file — use whichever the existing arrow code reads).

- [ ] **Step 3: Replace path geometry with the helper**

For each rendered arrow, compute `from` = predecessor bar right-edge midpoint and `to` = successor bar left-edge midpoint using the existing bar-geometry map (the L287-303 useMemo output gives x/y/width). Then:
```ts
const d = orthogonalArrowPath(
  { x: pred.x + pred.width, y: pred.y + BAR_HEIGHT / 2 },
  { x: succ.x, y: succ.y + BAR_HEIGHT / 2 },
);
```
Render as `<Path d={d} .../>` (replace the existing curve/marching-ants path generation).

- [ ] **Step 4: Restyle the stroke + marker**

Apply spec §4.3:
```tsx
<Path
  d={d}
  stroke={isCritical ? '#b91c1c' : '#374151'}
  strokeWidth={1.25}
  strokeLinecap="round"
  strokeLinejoin="round"
  strokeDasharray="4 3"
  fill="none"
  markerEnd={isCritical ? 'url(#gantt-head-crit)' : 'url(#gantt-head)'}
/>
```
In the SVG `<Defs>`, define the two small markers (replace the existing larger marker, L680-697):
```tsx
<Marker id="gantt-head" markerWidth={5} markerHeight={5} refX={5} refY={2.5} orient="auto">
  <Polygon points="0 0, 5 2.5, 0 5" fill="#374151" />
</Marker>
<Marker id="gantt-head-crit" markerWidth={5} markerHeight={5} refX={5} refY={2.5} orient="auto">
  <Polygon points="0 0, 5 2.5, 0 5" fill="#b91c1c" />
</Marker>
```
`isCritical` for an arrow = both endpoints are on the critical path (use the same `cpm.criticalPathIds` field verified in Task 2).

- [ ] **Step 5: tsc gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Manual verify**

In the app: with no bar selected, NO arrows show. Click a bar → only its direct predecessor + successor arrows appear, orthogonal (right-angled), small arrowhead landing on the bar's left edge, dark gray (red if critical), dashed and marching. Create or open a task pair where the successor starts before the predecessor ends → arrow routes around the bar, not through it.

- [ ] **Step 7: Commit**

```bash
git add components/schedule/InteractiveGantt.tsx
git commit -m "feat(gantt): orthogonal arrows, smaller heads, hidden unless a bar is focused"
```

---

## Task 4: Animation — calm marching ants + reduced-motion guard

**Files:**
- Modify: `components/schedule/InteractiveGantt.tsx`

The existing component animates `strokeDashoffset` via `Animated.Value` (noted in the file header). Keep that mechanism but tune it to the calm 1.4s loop and add the reduced-motion guard.

- [ ] **Step 1: Verify the existing animation driver**

Find the `Animated.Value` + `Animated.loop` that drives `strokeDashoffset` (grep `strokeDashoffset` / `Animated.loop`). Confirm the arrows use `AnimatedPath` (the `Animated.createAnimatedComponent(Path)` pattern react-native-svg needs).

- [ ] **Step 2: Tune duration + offset**

Set the loop to 1.4s linear infinite, animating `strokeDashoffset` 0 → -7 (matches `strokeDasharray="4 3"` = 7-unit period):
```ts
Animated.loop(
  Animated.timing(dashAnim, {
    toValue: -7,
    duration: 1400,
    easing: Easing.linear,
    useNativeDriver: true,
  }),
).start();
```

- [ ] **Step 3: Reduced-motion guard**

Import and check the OS reduced-motion setting:
```ts
import { AccessibilityInfo } from 'react-native';
// in an effect:
AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
// cleanup: sub.remove();
```
When `reduceMotion` is true: do not start the loop; render arrows with a solid stroke (`strokeDasharray={undefined}`). On web, also respect the CSS media query if the component renders to DOM — but the `AccessibilityInfo` API covers RN-Web too.

- [ ] **Step 4: tsc gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual verify**

Arrows on the focused chain animate as a calm left-to-right drift (~1.4s). Toggle macOS System Settings → Accessibility → Display → Reduce Motion → arrows become solid, no animation.

- [ ] **Step 6: Commit**

```bash
git add components/schedule/InteractiveGantt.tsx
git commit -m "feat(gantt): calm 1.4s marching-ants + prefers-reduced-motion guard"
```

---

## Task 5: Selection decorations — dashed ring + circle handles + tooltip

**Files:**
- Modify: `components/schedule/InteractiveGantt.tsx`

Reuse the EXISTING `focusedTaskId` prop as "selected." Add decorations to the focused bar only.

- [ ] **Step 1: Render the dashed selection ring**

For the bar whose `t.id === focusedTaskId`, render an SVG `<Rect>` (or RN `<View>` in the bar layer) ~2px outside the bar on each side:
```tsx
<SvgRect
  x={bar.x - 2}
  y={bar.y - 2}
  width={bar.width + 4}
  height={BAR_HEIGHT + 4}
  rx={6}
  fill="none"
  stroke="#2563eb"
  strokeWidth={1.5}
  strokeDasharray="3 2"
/>
```

- [ ] **Step 2: Render the circle handles**

At the focused bar's left + right edges, mid-height:
```tsx
<SvgCircle cx={bar.x} cy={bar.y + BAR_HEIGHT / 2} r={4} fill="#fff" stroke="#2563eb" strokeWidth={1.5} />
<SvgCircle cx={bar.x + bar.width} cy={bar.y + BAR_HEIGHT / 2} r={4} fill="#fff" stroke="#2563eb" strokeWidth={1.5} />
```
(`SvgCircle` is `Circle` from react-native-svg — verify the import alias used in the file.)

- [ ] **Step 3: Render the date-range tooltip**

Above the focused bar, a dark pill showing the date range. Compute start/end dates from `projectStartDate + startDay` and `+ duration` (reuse the same date helper the today-marker uses, around L763). Render as an absolutely-positioned `<View>` overlay (NOT inside the SVG, so text rendering is crisp):
```tsx
{focusedBar && (
  <View style={[styles.selTooltip, { left: focusedBar.x + 8, top: focusedBar.y - 22 }]}>
    <Text style={styles.selTooltipText}>{startLabel} → {endLabel} · {duration}d</Text>
  </View>
)}
```
```ts
selTooltip: {
  position: 'absolute', backgroundColor: '#111827',
  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, zIndex: 20,
},
selTooltipText: { color: '#fff', fontSize: 11, fontWeight: '500' },
```
Clamp `left` so the tooltip doesn't clip past the timeline's right edge (if `focusedBar.x + tooltipWidthEstimate > timelineWidth`, left-shift it).

- [ ] **Step 4: Selected row tint in the gutter**

In the task-name gutter (left column), when a row's `t.id === focusedTaskId`, apply background `#eff6ff` and name color `#1e40af` + `fontWeight: '600'`. (Find the gutter row render; it's the left-side list. Skip if `compact` mode hides the gutter.)

- [ ] **Step 5: Live tooltip + handles during drag**

The drag already updates an Animated overlay (L392 area). Ensure the tooltip text + handle positions track the drag preview: during `onPanResponderMove`, the focused bar's previewed x/width should feed the tooltip date computation + handle cx. Use the existing drag-preview state (`dragState`) the component already maintains — read its previewed startDay/duration for the focused task.

- [ ] **Step 6: tsc gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Manual verify**

Click a bar → dashed blue ring + two white circle handles at the edges + dark tooltip above showing the date range, and the left-gutter row tints blue. Drag the bar → tooltip date range + handles track live. Click another bar → decorations move. Click empty area → decorations clear.

- [ ] **Step 8: Commit**

```bash
git add components/schedule/InteractiveGantt.tsx
git commit -m "feat(gantt): selection decorations — dashed ring, circle handles, live date tooltip"
```

---

## Task 6: Today pill + weekend shading

**Files:**
- Modify: `components/schedule/InteractiveGantt.tsx`

- [ ] **Step 1: Weekend column shading**

In the grid-line render (L763-810 area, where day columns are drawn), for each day whose weekday is Saturday or Sunday, draw a full-height subtle fill. Compute weekday from `projectStartDate + (dayNumber - 1)`:
```tsx
// for each day d in [1..totalDays]:
const date = new Date(projectStartDate); date.setDate(date.getDate() + (d - 1));
const isWeekend = date.getDay() === 0 || date.getDay() === 6;
// if isWeekend: render <SvgRect x={(d-1)*pxPerDay} y={0} width={pxPerDay} height={gridHeight} fill="#fafaf9" />
```
Render weekend rects BEHIND the bars (early in the SVG child order).

- [ ] **Step 2: Today pill label**

The today line already renders at `todayX` (L764). Add a small pill at its top:
```tsx
<View style={[styles.todayPill, { left: todayX - 18 }]}>
  <Text style={styles.todayPillText}>TODAY</Text>
</View>
```
```ts
todayPill: {
  position: 'absolute', top: 0, backgroundColor: '#fff',
  borderWidth: 1, borderColor: '#fecaca', borderRadius: 3,
  paddingHorizontal: 4, paddingVertical: 2, zIndex: 21,
},
todayPillText: { color: '#ef4444', fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
```

- [ ] **Step 3: tsc gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual verify**

Weekends show a subtle gray column behind bars. The today line has a small "TODAY" pill at its top that stays visible while scrolling the timeline.

- [ ] **Step 5: Commit**

```bash
git add components/schedule/InteractiveGantt.tsx
git commit -m "feat(gantt): weekend column shading + today pill label"
```

---

## Task 7: AddTaskModal — accept a default start day

**Files:**
- Modify: `components/schedule/AddTaskModal.tsx` (L43-52 props + the form's start-day field)

- [ ] **Step 1: Add the prop**

In `AddTaskModalProps` (L43) add:
```ts
/** Pre-fill the start day (1-based day number from project start). Used by the
 *  gantt double-click-to-add entry point. Omit for the default (today / next). */
defaultStartDay?: number;
```
Add it to the destructure at L52: `export function AddTaskModal({ visible, onCancel, onCreate, tasks, defaultStartDay }: AddTaskModalProps) {`

- [ ] **Step 2: Pre-fill the field on open**

In the effect that resets form state when `visible` becomes true (L79-91), if `defaultStartDay != null`, initialize the start-day form field to it instead of the default. Match whatever the form's existing start-day state shape is (read L79-91 + the create payload to use the same units — day number vs date string).

- [ ] **Step 3: tsc gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual verify (deferred to Task 8)**

Can't fully verify until the gantt passes the prop — verified end-to-end in Task 8.

- [ ] **Step 5: Commit**

```bash
git add components/schedule/AddTaskModal.tsx
git commit -m "feat(add-task): optional defaultStartDay prop for gantt double-click entry"
```

---

## Task 8: Double-click handlers — empty timeline + existing bar

**Files:**
- Modify: `components/schedule/InteractiveGantt.tsx` (background double-click detection + a new `onAddTaskAtDay` prop)
- Modify: `app/schedule-pro.tsx` (wire `onAddTaskAtDay` → open AddTaskModal with `defaultStartDay`)

- [ ] **Step 1: Add the prop to InteractiveGantt**

In `InteractiveGanttProps` add:
```ts
/** Fires when the user double-clicks empty timeline space. dayNumber is 1-based. */
onAddTaskAtDay?: (dayNumber: number) => void;
```

- [ ] **Step 2: Detect double-click/tap on the timeline background**

On the timeline background `Pressable` (NOT on bars), detect a double-activation:
```ts
const lastTapRef = useRef<{ t: number; x: number } | null>(null);
const handleBackgroundPress = useCallback((evt: GestureResponderEvent) => {
  const now = Date.now();
  const x = evt.nativeEvent.locationX;
  const prev = lastTapRef.current;
  lastTapRef.current = { t: now, x };
  if (prev && now - prev.t < 300 && Math.abs(x - prev.x) < 10) {
    // double-tap/click → resolve day from x
    const dayNumber = Math.max(1, Math.floor(x / pxPerDay) + 1);
    onAddTaskAtDay?.(dayNumber);
    lastTapRef.current = null;
  }
}, [pxPerDay, onAddTaskAtDay]);
```
Wire to the background layer's `onPress`. Ensure bars `stopPropagation`/claim their own touches so a bar tap doesn't count as a background tap (bars already have their PanResponder + focus handlers; verify they don't bubble to the background).

- [ ] **Step 3: Bar double-click → inspector (verify existing behavior)**

Selecting a bar already sets `focusedTaskId`, which already opens the TaskInspector (`app/schedule-pro.tsx:1395`). Confirm a single tap on a bar opens the inspector. If the desired behavior is single-tap-selects + double-tap-opens-inspector, split it; otherwise leave the existing single-tap-opens-inspector (simpler, already works). Document the decision in a code comment.

- [ ] **Step 4: Wire schedule-pro**

In `app/schedule-pro.tsx`, add state for the prefill day and pass the handler to InteractiveGantt + the prop to AddTaskModal:
```ts
const [prefillStartDay, setPrefillStartDay] = useState<number | undefined>(undefined);
const handleAddTaskAtDay = useCallback((dayNumber: number) => {
  setPrefillStartDay(dayNumber);
  handleAddTask(); // existing opener (L576) — opens AddTaskModal
}, [handleAddTask]);
```
On the `<InteractiveGantt ... />` usage (L1377-1381) add `onAddTaskAtDay={handleAddTaskAtDay}`.
On the `<AddTaskModal ... />` usage (L1545) add `defaultStartDay={prefillStartDay}`.
Clear `prefillStartDay` back to `undefined` in the modal's onCancel + onCreate handlers so the next manual "Add Task" button press doesn't inherit a stale day.

- [ ] **Step 5: tsc gate**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Manual verify (full end-to-end)**

- Single-click empty timeline → nothing opens.
- Double-click empty timeline at, say, the Wk-3 Monday column → AddTaskModal opens with the start day matching that column's date.
- Cancel, then press the toolbar "Add Task" button → modal opens WITHOUT a stale prefilled day.
- Double-click (or the existing single-tap, per Step 3) a bar → TaskInspector opens.

- [ ] **Step 7: Commit**

```bash
git add components/schedule/InteractiveGantt.tsx app/schedule-pro.tsx
git commit -m "feat(gantt): double-click empty timeline opens Add Task pre-filled with that day"
```

---

## Task 9: Cross-platform QA pass + spec checklist

**Files:** none (verification only)

- [ ] **Step 1: Walk the spec §10 checklist on web**

Run `bun run start-web`, open Schedule → Gantt, walk all 13 items in spec §10 (selection, drag-snap, double-click-add, inspector, critical arrow color, overlap routing, reduced-motion).

- [ ] **Step 2: Walk it on iOS Simulator**

Run `bun run start`, open in iOS Simulator, repeat the touch-relevant items (tap-to-select, double-tap-to-add, drag, long-press inspector).

- [ ] **Step 3: Final tsc gate (repo-wide)**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Confirm scope ledger**

Run: `git diff --stat main..HEAD` — confirm ONLY these files changed across all commits:
`utils/ganttArrowPath.ts`, `components/schedule/InteractiveGantt.tsx`, `components/schedule/AddTaskModal.tsx`, `app/schedule-pro.tsx`, plus the plan/spec docs. NOTHING else (no CPM engine, no GridPane, no other components).

- [ ] **Step 5: No commit** — this is a verification gate. If anything fails, fix in the relevant task's file and re-commit there.

---

## Notes for the implementer

- **The drag mechanics already work and already snap to day** (L392). Do not rewrite the PanResponder. Tasks 2-6 are styling; Task 5 only READS the existing drag-preview state to feed the tooltip.
- **Selection is `focusedTaskId`** — already parent-owned and wired. Do not add new selection state.
- **Verify field names before using them:** `cpm.criticalPathIds` (the critical-path id set — confirm exact name via grep `cpm\.` in the file), the done-detection (`progress`/`status`), and the dependency source (`dependencyLinks` vs `dependencies`). The plan references these generically; bind them to the real names during Task 2/3.
- **`compact` and `mode='phone'`** variants exist. Each visual change must respect them (e.g., Task 5 Step 4 gutter tint is skipped in `compact` mode where the gutter is hidden). Check both render paths.
- **No deploy in this plan.** All commits sit on `claude/p0-launch-on-main`. The controller batches the OTA later, per the standing "conserve OTA pushes" directive.

---

## Self-review (done by plan author)

**Spec coverage:** §2 bars → Task 2. §3 selection → Task 5. §4 arrows → Tasks 1+3+4. §5 double-click → Tasks 7+8. §6 selection-location → resolved (reuse focusedTaskId, noted in Architecture). §7 chrome → Task 6. §8 drag → Task 5 Step 5 (snap already exists per L392). §9 out-of-scope → not built (correct). §10 testing → Task 9. §11 phases → map to Tasks 2-8. §12 risks → addressed (arrows only for 1 focused task; tooltip via existing overlay; rollback = per-task commits). **No gaps.**

**Placeholder scan:** No TBD/TODO. The "verify exact field name" notes are deliberate (the plan can't invent field names it hasn't confirmed) and are scoped to a grep, not open-ended work.

**Type consistency:** `orthogonalArrowPath(from, to)` signature consistent across Task 1 (def) + Task 3 (call). `defaultStartDay` consistent across Task 7 (AddTaskModal) + Task 8 (schedule-pro). `onAddTaskAtDay(dayNumber)` consistent across Task 8 def + wire.
