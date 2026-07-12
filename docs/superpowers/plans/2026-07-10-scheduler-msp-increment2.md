# Scheduler MSP-Modern — Increment 2 (Outline authoring + Context menu + Printable Gantt) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Pro scheduler *authorable* like Microsoft Project — structure the plan (indent/outdent, reorder, summary bars) via a right-click/long-press row+bar menu — and hand out a real **printable fit-to-page Gantt**, not a plain table.

**Architecture:** All three build on data the app already has. Outline authoring writes `outlineLevel`/`parentId` via the existing `onEdit`; reordering swaps positions in the parent's task array via a new `onReorder` callback (task order is array-position). `computeSummaryRollup` already rolls children up; we add the *indentation + summary-bar rendering* and the *authoring gestures*. The context menu reuses the existing cross-platform `EntityActionSheet` pattern. The printable Gantt reuses `InteractiveGantt`'s bar geometry, emitted as an SVG string through `expo-print`.

**Tech Stack:** React Native / Expo, TS strict, `bun`, `useThemedStyles` + `Colors`/`Type`/`Tokens` (anti-slop lint), `lucide-react-native`. No jest — pure fns validated by `scripts/validate-*.ts`. **OTA-safe: no new native modules.** CPM outputs / offline queue / persistence untouched (we only reorder + set outline fields through existing edit paths). Owner verifies visuals at merge. Branch: `claude/scheduler-front-door`.

**Key OTA-safe decision:** the spec mentioned *drag-to-reorder*. Drag-reorder rows needs a native gesture lib (e.g. `react-native-draggable-flatlist`), which would break OTA-safety and force a native build. This increment delivers reordering via **Move up / Move down** (context menu + Grid buttons) instead — same outcome, OTA-shippable. True drag-to-reorder is deferred to a future native build.

---

## File Structure

**New**
- `utils/outlineOps.ts` — pure helpers: `indentTask`, `outdentTask`, `moveTask` (returns a reordered/reparented task array). No React, no I/O.
- `scripts/validate-outline-ops.ts` — validator for the above.
- `utils/printableGanttHtml.ts` — pure: `buildPrintableGanttHtml(tasks, opts)` → an HTML string with an inline SVG Gantt. No React, no I/O.
- `scripts/validate-printable-gantt.ts` — validator (asserts the HTML/SVG contains bars, arrows, today line, milestones for a fixture).
- `components/schedule/ScheduleRowMenu.tsx` — the row/bar context menu (wraps the `EntityActionSheet` cross-platform pattern for scheduler actions).

**Modified**
- `types/index.ts` — (only if needed) confirm `parentId`/`outlineLevel`/`isSummary`/`collapsed` exist (they do, lines 502-505); no change expected.
- `components/schedule/GridPane.tsx` — indentation from `outlineLevel`; summary-row styling; a row long-press/right-click that opens `ScheduleRowMenu`; Move up/down + Indent/Outdent handlers.
- `app/schedule-pro.tsx` — add `onReorder` (array move) + `onOutline` (indent/outdent) handlers wired to the undo-aware `commit`; pass them down; replace `handleAirPrint`'s table HTML with `buildPrintableGanttHtml`.
- `components/schedule/InteractiveGantt.tsx` — bar long-press (native)/right-click (web) opens `ScheduleRowMenu` (reusing the disabled-longpress note at ~611 by triggering on a distinct gesture); render summary bars.
- `components/schedule/SchedulerTabShell.tsx` + `tabs/GanttTab.tsx` — thread `onReorder`/`onOutline` through to Grid + Gantt.
- `package.json` — add `test:outline-ops` + `test:printable-gantt` to `ship-check`.

**Task order:** 1 (outline pure ops + validator) → 2 (context menu + Grid authoring wiring) → 3 (printable Gantt). Sequential.

---

### Task 1: Pure outline operations + validator

**Files:** Create `utils/outlineOps.ts`, `scripts/validate-outline-ops.ts`; modify `package.json`.

**Context:** `ScheduleTask` has `parentId?`, `outlineLevel?`, `collapsed?`, `isSummary?` (types/index.ts:502-505). Tasks are ordered by **array position** (no `order` field). `computeSummaryRollup(tasks)` and `getHiddenTaskIds(tasks)` already exist in `utils/summaryRollup.ts`.

- [ ] **Step 1: Write the failing validator** — `scripts/validate-outline-ops.ts`:
```ts
// scripts/validate-outline-ops.ts — pure-fn validator for utils/outlineOps.ts.
import { indentTask, outdentTask, moveTask } from '../utils/outlineOps';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function eq<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, '\n   got ', got, '\n   want', want); }
}
const T = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({ id, title: id, startDay: 1, durationDays: 1, dependencies: [], ...over } as ScheduleTask);

// indent: task adopts the previous sibling as parent, outlineLevel +1.
const list = [T('a'), T('b'), T('c')];
const indented = indentTask(list, 'b');
eq('indent sets parentId to previous row', indented.find(t => t.id === 'b')?.parentId, 'a');
eq('indent sets outlineLevel 1', indented.find(t => t.id === 'b')?.outlineLevel, 1);
eq('indent first row is a no-op (no prior sibling)', indentTask(list, 'a'), list);

// outdent: clears one level of parent.
const out = outdentTask(indented, 'b');
eq('outdent clears parentId', out.find(t => t.id === 'b')?.parentId, undefined);
eq('outdent sets outlineLevel 0', out.find(t => t.id === 'b')?.outlineLevel, 0);

// move: swaps array position by delta, clamped.
const moved = moveTask(list, 'c', -1);
eq('move up swaps positions', moved.map(t => t.id), ['a', 'c', 'b']);
eq('move down at end is a no-op', moveTask(list, 'c', 1).map(t => t.id), ['a', 'b', 'c']);
eq('move up at top is a no-op', moveTask(list, 'a', -1).map(t => t.id), ['a', 'b', 'c']);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run to verify it fails** — `bun run scripts/validate-outline-ops.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `utils/outlineOps.ts`:**
```ts
// utils/outlineOps.ts — pure outline/reorder ops on the task array. No React, no I/O.
// Task order is array position; hierarchy is parentId + outlineLevel.
import type { ScheduleTask } from '../types';

/** Indent a task under the immediately-preceding row (its new parent), +1 level.
 *  No-op if the task is the first row (nothing to parent under). */
export function indentTask(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  const i = tasks.findIndex(t => t.id === id);
  if (i <= 0) return tasks;
  const parent = tasks[i - 1];
  return tasks.map(t => t.id === id
    ? { ...t, parentId: parent.id, outlineLevel: (parent.outlineLevel ?? 0) + 1 }
    : t);
}

/** Outdent a task one level (clears parent when returning to level 0). */
export function outdentTask(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  return tasks.map(t => {
    if (t.id !== id) return t;
    const next = Math.max(0, (t.outlineLevel ?? 0) - 1);
    return { ...t, outlineLevel: next, parentId: next === 0 ? undefined : t.parentId };
  });
}

/** Move a task by delta rows (-1 up, +1 down), clamped to array bounds. */
export function moveTask(tasks: ScheduleTask[], id: string, delta: number): ScheduleTask[] {
  const i = tasks.findIndex(t => t.id === id);
  if (i < 0) return tasks;
  const j = i + delta;
  if (j < 0 || j >= tasks.length) return tasks;
  const next = tasks.slice();
  const [row] = next.splice(i, 1);
  next.splice(j, 0, row);
  return next;
}
```

- [ ] **Step 4: Run to verify it passes** — `bun run scripts/validate-outline-ops.ts` → `8 passed, 0 failed`.

- [ ] **Step 5: Wire into `package.json`** — add `"test:outline-ops": "bun run scripts/validate-outline-ops.ts",` and append `&& bun run test:outline-ops` to `ship-check`.

- [ ] **Step 6: Type-check + commit** — `npx tsc --noEmit` clean.
```bash
git add utils/outlineOps.ts scripts/validate-outline-ops.ts package.json
git commit -m "feat(scheduler): pure outline ops (indent/outdent/move) + validator"
```

---

### Task 2: Row/bar context menu + Grid outline authoring

**Files:** Create `components/schedule/ScheduleRowMenu.tsx`; modify `components/schedule/GridPane.tsx`, `app/schedule-pro.tsx`, `components/schedule/SchedulerTabShell.tsx`, `components/schedule/tabs/GanttTab.tsx`, `components/schedule/InteractiveGantt.tsx`.

**Context:** `EntityActionSheet` (`components/EntityActionSheet.tsx`) is the repo's cross-platform action-sheet pattern (iOS `ActionSheetIOS`, Android/web modal). GridPane renders rows via `ScrollView.map` (GridPane.tsx:1348-1393) in array order, filtering `getHiddenTaskIds`; it commits edits with `onEdit(taskId, patch)` (line 220); selection is click+modifier (`toggleRow`, line 370) with **no long-press**. Bars in InteractiveGantt intentionally don't long-press (line 611 comment). `schedule-pro` owns task state in `hist.present` and mutates through `commit(fn)` (undo-aware).

- [ ] **Step 1: Create `ScheduleRowMenu.tsx`**

A small controlled menu that renders the scheduler row actions. Model it on `EntityActionSheet` (read that file first and mirror its Platform split + styling). Actions are passed in as a list; the component just renders + dispatches. Complete shape:
```tsx
// components/schedule/ScheduleRowMenu.tsx — row/bar context menu for the scheduler.
// Cross-platform (iOS ActionSheetIOS / web+Android modal), mirrors EntityActionSheet.
import { Platform, ActionSheetIOS, Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface RowMenuAction { key: string; label: string; destructive?: boolean; onPress: () => void }

export function useScheduleRowMenu() {
  // Imperative helper for iOS native sheet; web/android use the <ScheduleRowMenu> modal.
  return (title: string, actions: RowMenuAction[]) => {
    if (Platform.OS === 'ios') {
      const options = [...actions.map(a => a.label), 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options, cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: actions.findIndex(a => a.destructive) >= 0 ? actions.findIndex(a => a.destructive) : undefined },
        (i) => { if (i < actions.length) actions[i].onPress(); },
      );
      return true; // handled imperatively
    }
    return false; // caller should open the modal instead
  };
}

export function ScheduleRowMenu({ visible, title, actions, onClose }: {
  visible: boolean; title: string; actions: RowMenuAction[]; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {actions.map(a => (
          <Pressable key={a.key} style={styles.item} onPress={() => { onClose(); a.onPress(); }}>
            <Text style={[styles.itemText, a.destructive && styles.destructive]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: t.overlay },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: t.surface, borderTopLeftRadius: Tokens.radius.lg, borderTopRightRadius: Tokens.radius.lg, paddingVertical: 8 },
  title: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textSecondary, paddingHorizontal: 18, paddingVertical: 8 },
  item: { paddingHorizontal: 18, paddingVertical: 13 },
  itemText: { fontSize: Type.body.fontSize, fontWeight: '600', color: t.text },
  destructive: { color: Colors.pillLate },
});
```
> `Colors.pillLate` is the repo's red semantic token (used in `SchedulerHeader`/`DashboardTab`). Read `components/EntityActionSheet.tsx` and, if it uses a more specific danger token, match that instead. **Never a raw hex** — the anti-slop lint fails on hex literals.

- [ ] **Step 2: Add outline + reorder handlers in `schedule-pro.tsx`**

Using the existing undo-aware `commit` and the pure ops:
```tsx
import { indentTask, outdentTask, moveTask } from '@/utils/outlineOps';
// ...
const handleOutline = useCallback((id: string, dir: 'indent' | 'outdent') => {
  commit(prev => (dir === 'indent' ? indentTask(prev, id) : outdentTask(prev, id)));
}, [commit]);
const handleReorder = useCallback((id: string, delta: number) => {
  commit(prev => moveTask(prev, id, delta));
}, [commit]);
```
Pass `onOutline={handleOutline}` and `onReorder={handleReorder}` into `<SchedulerTabShell>`; thread both through `SchedulerTabShellProps` → `GanttTab` → `GridPane` and `InteractiveGantt` (add the two optional props to each interface). (`commit` already snapshots for undo + persists; confirm its signature by reading the existing `handleLoadDemo` which calls `commit(() => seedDemoSchedule())`.)

- [ ] **Step 3: Wire the menu into GridPane rows**

Add a row long-press (native) / `onContextMenu` (web) to the row `View` (GridPane.tsx:1371) that assembles the actions and opens the menu. Actions:
```tsx
const rowActions = (task: ScheduleTask, rowIndex: number): RowMenuAction[] => [
  { key: 'indent',  label: 'Indent',        onPress: () => onOutline?.(task.id, 'indent') },
  { key: 'outdent', label: 'Outdent',       onPress: () => onOutline?.(task.id, 'outdent') },
  { key: 'up',      label: 'Move up',       onPress: () => onReorder?.(task.id, -1) },
  { key: 'down',    label: 'Move down',     onPress: () => onReorder?.(task.id, 1) },
  { key: 'ms',      label: task.isMilestone ? 'Unmark milestone' : 'Convert to milestone', onPress: () => onEdit(task.id, { isMilestone: !task.isMilestone }) },
  { key: 'done',    label: 'Mark complete', onPress: () => onEdit(task.id, { status: 'done', progress: 100 }) },
  { key: 'del',     label: 'Delete',        destructive: true, onPress: () => onDeleteTask(task.id) },
];
```
Use `useScheduleRowMenu()` for iOS (imperative), and a `menuState` + `<ScheduleRowMenu>` for web/android (when the hook returns `false`). Trigger via `onLongPress` on the row `Pressable`/`View` and, on web, `onContextMenu={(e) => { e.preventDefault(); openMenu(task, rowIndex); }}`.

- [ ] **Step 4: Render indentation + summary rows in GridPane**

Apply `paddingLeft` from `outlineLevel` to the first (title) cell, and style summary rows (`task.isSummary`) bold with a subtle background. In the row `style` array (GridPane.tsx:1375) add `task.isSummary && styles.rowSummary`, and in the title cell renderer add `paddingLeft: (task.outlineLevel ?? 0) * 16`. Add `rowSummary` to the StyleSheet (tokens only: `backgroundColor: Colors.surfaceAlt`, `fontWeight` on the title via a `summaryTitle` style).

- [ ] **Step 5: Wire the menu onto Gantt bars (web right-click / native long-press)**

In `InteractiveGantt.tsx`, add to each bar an `onLongPress` (native) and `onContextMenu` (web) that opens the same `ScheduleRowMenu` with `rowActions(task)`. This is safe because it triggers on long-press/right-click, distinct from the drag PanResponder (the line-611 note only blocks long-press *inside the PanResponder*; a Pressable `onLongPress` on the bar wrapper is fine). Thread `onOutline`/`onReorder`/`onDeleteTask` into InteractiveGantt's props.

- [ ] **Step 6: Verify + commit**

`npx tsc --noEmit` clean; `bun run lint` 0 errors, no new warnings.
```bash
git add components/schedule/ScheduleRowMenu.tsx components/schedule/GridPane.tsx app/schedule-pro.tsx components/schedule/SchedulerTabShell.tsx components/schedule/tabs/GanttTab.tsx components/schedule/InteractiveGantt.tsx
git commit -m "feat(scheduler): row/bar context menu — indent/outdent, move up/down, milestone, delete; grid indentation + summary rows"
```

---

### Task 3: Printable fit-to-page Gantt one-pager

**Files:** Create `utils/printableGanttHtml.ts`, `scripts/validate-printable-gantt.ts`; modify `app/schedule-pro.tsx`, `package.json`.

**Context:** `handleAirPrint` (schedule-pro.tsx:1171-1215) builds a 6-column HTML **table** and calls `Print.printAsync({ html })` (`expo-print`, dynamic import). Bar geometry (InteractiveGantt.tsx:293-314): `x = (startDay-1)*pxPerDay`, bar width `Math.max(MIN_BAR_PX_WIDTH, duration*pxPerDay)`, `y = HEADER_HEIGHT + index*ROW_HEIGHT + BAR_VERTICAL_PADDING`; today `x = (todayDayNumber-1)*pxPerDay`; last-dated milestone renders red (`#FF5A51`).

- [ ] **Step 1: Write the failing validator** — `scripts/validate-printable-gantt.ts`:
```ts
// scripts/validate-printable-gantt.ts — asserts the printable Gantt HTML contains the key marks.
import { buildPrintableGanttHtml } from '../utils/printableGanttHtml';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const T = (id: string, o: Partial<ScheduleTask> = {}): ScheduleTask => ({ id, title: id, startDay: 1, durationDays: 5, dependencies: [], ...o } as ScheduleTask);

const html = buildPrintableGanttHtml(
  [T('a', { startDay: 1, durationDays: 5 }), T('b', { startDay: 6, durationDays: 3, dependencies: ['a'], isCriticalPath: true }), T('m', { startDay: 9, durationDays: 0, isMilestone: true })],
  { projectName: 'Test', todayDayNumber: 4, totalDays: 12 },
);
ok('is an html doc', html.includes('<html') && html.includes('</html>'));
ok('has an svg canvas', html.includes('<svg'));
ok('renders a bar rect', html.includes('<rect'));
ok('renders a dependency line (a→b)', html.toLowerCase().includes('<line') || html.toLowerCase().includes('<path'));
ok('renders the today line', html.includes('today') || html.includes('Today'));
ok('renders a milestone diamond (polygon)', html.includes('<polygon'));
ok('shows the project name', html.includes('Test'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run to verify it fails** — `bun run scripts/validate-printable-gantt.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `utils/printableGanttHtml.ts`** — a pure function that emits a landscape, fit-to-page HTML page with an inline SVG Gantt (title block, day grid, bars, FS dependency lines, milestone diamonds, red critical path, today line, legend). Reuse the geometry constants. Escape text. Signature:
```ts
export interface PrintableGanttOpts { projectName: string; todayDayNumber: number; totalDays: number; }
export function buildPrintableGanttHtml(tasks: ScheduleTask[], opts: PrintableGanttOpts): string
```
Implementation notes (write the full function): pick `PX_PER_DAY` so `totalDays * pxPerDay` fits a ~1000px canvas (`const px = Math.max(2, Math.min(24, Math.floor(980 / Math.max(1, opts.totalDays))))`); `ROW_H = 22`, `BAR_H = 12`; for each task compute `x=(startDay-1)*px`, `w=Math.max(3, durationDays*px)`, `y=headerH + i*ROW_H`; draw a left label column (task titles, indented by `outlineLevel`); draw `<rect>` bars (red `#b91c1c` when `isCriticalPath`, else `#4b5563`), zero-duration/`isMilestone` as a `<polygon>` diamond (last-dated red `#FF5A51`); draw FS dependency `<line>`s from each predecessor's right edge to the successor's left edge in gray; a dashed `<line>` at `today x` labelled "Today"; a small legend. Wrap in `<html><head><style>@page{size:landscape} …</style></head><body>…</body></html>`. Use `@media print` + a `@page { size: landscape; margin: 12mm; }` so it fits a page.

- [ ] **Step 4: Run to verify it passes** — `bun run scripts/validate-printable-gantt.ts` → `7 passed, 0 failed`.

- [ ] **Step 5: Swap `handleAirPrint` to use it**

In `schedule-pro.tsx:1171-1215`, replace the table HTML with:
```tsx
const Print = await import('expo-print');
const { buildPrintableGanttHtml } = await import('@/utils/printableGanttHtml');
const html = buildPrintableGanttHtml(workingTasks, {
  projectName: project?.name ?? 'Schedule',
  todayDayNumber, // reuse the same value InteractiveGantt uses; if not in scope here, compute from projectStartDate + today
  totalDays: cpm.projectFinish,
});
await Print.printAsync({ html });
```
(If `todayDayNumber` isn't in scope in `schedule-pro`, compute it the same way InteractiveGantt does from `projectStartDate` and the current date, in a small local helper. Keep the old `escapeHtml` for reuse inside `printableGanttHtml.ts`.)

- [ ] **Step 6: Wire validator + verify + commit**

Add `"test:printable-gantt": "bun run scripts/validate-printable-gantt.ts",` and append `&& bun run test:printable-gantt` to `ship-check`. `npx tsc --noEmit` clean; `bun run lint` 0 errors.
```bash
git add utils/printableGanttHtml.ts scripts/validate-printable-gantt.ts app/schedule-pro.tsx package.json
git commit -m "feat(scheduler): printable fit-to-page Gantt one-pager (bars + arrows + milestones + today line) replaces table print"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → clean.
- [ ] `bun run lint` → 0 errors; no new warnings in touched files.
- [ ] `bun run scripts/validate-outline-ops.ts` → `8 passed`; `bun run scripts/validate-printable-gantt.ts` → `7 passed`.
- [ ] `bun run ship-check` → passes end-to-end (includes both new validators).
- [ ] **Owner visual review at merge:** right-click / long-press a grid row or Gantt bar → menu with Indent/Outdent, Move up/down, Convert to milestone, Mark complete, Delete; indented rows show hierarchy and summary rows read as summaries; AirPrint/PDF now produces a landscape Gantt (bars, arrows, milestones, red critical path, today line), not a table.

## Out of scope (deferred)
True drag-to-reorder rows (needs a native gesture lib → a future native build); visual ripple-preview before commit; a consolidated Task-Information popover (would overlap `TaskInspector`); iOS drag-to-link.
