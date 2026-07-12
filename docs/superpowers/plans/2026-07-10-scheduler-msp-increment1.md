# Scheduler MSP-Modern — Increment 1 (Dependency-line polish + Plan/Track/Share nav) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Pro Timeline's dependency arrows read like Microsoft Project (crisp routing, fanned arrowheads, visible non-default link types), and replace the three competing nav models with one **Plan ▾ / Track ▾ / Share ▾** menu bar.

**Architecture:** Arrow work is presentation-only in the pure `orthogonalArrowPath` + the `InteractiveGantt` SVG layer (the FS/SS/FF/SF+lag engine and the drag-to-link picker already exist and are untouched). Nav work introduces a `SchedulerMenuBar` component that merges view-switching (the existing `active` tab state) with the action handlers already defined in `schedule-pro`, passed down as one `actions` object; the old tab strip and `More` overflow are removed.

**Tech Stack:** React Native / Expo, TS strict, `bun`, `useThemedStyles(makeStyles)` + `Colors`/`Type`/`Tokens` (anti-slop lint: no hex / inline `fontSize` / `borderRadius` literals), `lucide-react-native`, amber accent. No jest — pure fns validated by `scripts/validate-*.ts` in `ship-check`. OTA-safe. **CPM outputs, offline queue, persistence untouched. Owner verifies visuals at merge** (Claude can't render the >900px web screen).

Branch: `claude/scheduler-front-door`. Increment 2 (outline authoring + context menu + printable Gantt) is a separate plan.

---

## File Structure

**New**
- `components/schedule/SchedulerMenuBar.tsx` — the Plan/Track/Share desktop menu bar (3 dropdowns merging views + actions).
- `scripts/validate-gantt-arrow.ts` — pure validator for `orthogonalArrowPath` (routing invariants at the new clearance).

**Modified**
- `utils/ganttArrowPath.ts` — widen `CLEARANCE`; land the arrowhead a gap before the successor edge.
- `components/schedule/InteractiveGantt.tsx` — heavier resting stroke; fan converging arrowheads (per-successor incoming index); small label for non-`FS`/non-zero-lag links.
- `components/schedule/SchedulerTabShell.tsx` — replace the desktop tab strip with `<SchedulerMenuBar>`; rename the phone `More` sheet to `Menu` grouped as Plan/Track/Share; accept an `actions` prop.
- `app/schedule-pro.tsx` — pass the `actions` object into the shell; delete the `More` overflow modal + `moreOpen` state (dissolved into the menus).
- `components/schedule/tabs/GanttTab.tsx` — drop `'grid'` from the layout set (List is the canonical spreadsheet).
- `package.json` — add `test:gantt-arrow` to `ship-check`.

**Task order:** 1 (arrows, self-contained) → 2 (desktop menu bar) → 3 (mobile Menu sheet). Sequential; 2 and 3 share `SchedulerTabShell`.

---

### Task 1: Crisp MS-Project dependency arrows

**Files:**
- Modify: `utils/ganttArrowPath.ts`
- Create: `scripts/validate-gantt-arrow.ts`
- Modify: `components/schedule/InteractiveGantt.tsx`
- Modify: `package.json`

**Context (verbatim current state):** `orthogonalArrowPath(from, to)` uses `const CLEARANCE = 3;` and lands exactly on `to.x`. In `InteractiveGantt.tsx`, `dependencyPaths` (lines ~654-682) builds one path per link from `{x: pred.x+pred.w, y: pred.y+BAR_HEIGHT/2}` to `{x: succ.x, y: succ.y+BAR_HEIGHT/2}`; the SVG layer (lines ~1145-1170) strokes each at `strokeWidth={emphasized ? 1.75 : 1.25}`, `strokeOpacity={dimmed ? 0.2 : 0.85}`, colors `#b91c1c` (critical) / `#374151` (normal), arrowhead via 5×5 `Marker`. No link-type label is drawn today.

- [ ] **Step 1: Write the failing validator**

Create `scripts/validate-gantt-arrow.ts`:
```ts
// scripts/validate-gantt-arrow.ts — pure-fn validator for utils/ganttArrowPath.ts.
// Run via `bun run scripts/validate-gantt-arrow.ts`. No jest in this repo.
import { orthogonalArrowPath, CLEARANCE, ARROW_LANDING_GAP } from '../utils/ganttArrowPath';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

// Clearance stepped up for a crisper, MS-Project-like routing.
ok('CLEARANCE widened to >= 10', CLEARANCE >= 10);
ok('landing gap exposed and > 0', ARROW_LANDING_GAP > 0);

// Standard case (successor to the right): path starts at pred, steps out by
// CLEARANCE, and lands a landing-gap short of the successor's left edge.
const std = orthogonalArrowPath({ x: 100, y: 10 }, { x: 400, y: 40 });
ok('standard path starts at pred', std.startsWith('M 100 10'));
ok('standard path steps out by CLEARANCE', std.includes(`L ${100 + CLEARANCE} 10`));
ok('standard path lands short of succ edge', std.trim().endsWith(`${400 - ARROW_LANDING_GAP} 40`));

// Overlap case (successor at/left of predecessor) still routes around via a mid gutter.
const ov = orthogonalArrowPath({ x: 400, y: 10 }, { x: 120, y: 40 });
ok('overlap path starts at pred', ov.startsWith('M 400 10'));
ok('overlap path lands short of succ edge', ov.trim().endsWith(`${120 - ARROW_LANDING_GAP} 40`));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run scripts/validate-gantt-arrow.ts`
Expected: FAIL — `CLEARANCE`/`ARROW_LANDING_GAP` not exported / values too small.

- [ ] **Step 3: Update `utils/ganttArrowPath.ts`**

Change the clearance constant and land the arrowhead a small gap before the successor edge so the 5px marker doesn't overrun the bar:
```ts
/** Horizontal clearance (px) the arrow steps out before turning. Wider than a
 *  hair so links visibly step out and turn — the crisp MS-Project look — instead
 *  of hugging the bar boundary. */
export const CLEARANCE = 12;

/** Land the arrowhead this many px left of the successor's edge so the marker
 *  triangle points AT the bar instead of overrunning it. */
export const ARROW_LANDING_GAP = 4;
```
In `orthogonalArrowPath`, land on `to.x - ARROW_LANDING_GAP` instead of `to.x` in BOTH branches. Standard branch:
```ts
export function orthogonalArrowPath(from: ArrowPoint, to: ArrowPoint): string {
  const landX = to.x - ARROW_LANDING_GAP;
  const standard = landX >= from.x + CLEARANCE;
  if (standard) {
    const turnX = from.x + CLEARANCE;
    return `M ${from.x} ${from.y} L ${turnX} ${from.y} L ${turnX} ${to.y} L ${landX} ${to.y}`;
  }
  const midY = (from.y + to.y) / 2;
  const outX = from.x + CLEARANCE;
  const backX = landX - CLEARANCE;
  return [
    `M ${from.x} ${from.y}`,
    `L ${outX} ${from.y}`,
    `L ${outX} ${midY}`,
    `L ${backX} ${midY}`,
    `L ${backX} ${to.y}`,
    `L ${landX} ${to.y}`,
  ].join(' ');
}
```

- [ ] **Step 4: Run the validator to verify it passes**

Run: `bun run scripts/validate-gantt-arrow.ts`
Expected: PASS — `7 passed, 0 failed`.

- [ ] **Step 5: Fan converging arrowheads + heavier resting stroke in `InteractiveGantt.tsx`**

In `dependencyPaths` (lines ~654-682), give each successor's incoming links a small vertical fan so multiple predecessors don't converge on one point. Track an incoming index per successor and offset the landing Y:
```ts
    const FAN_STEP = 4; // px between stacked arrowheads landing on one bar
    for (const succ of bars) {
      const links = succ.task.dependencyLinks && succ.task.dependencyLinks.length > 0
        ? succ.task.dependencyLinks
        : succ.task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
      const n = links.length;
      links.forEach((link, i) => {
        const pred = barById.get(link.taskId);
        if (!pred) return;
        const criticalBoth = pred.isCritical && succ.isCritical;
        const connected = activeId != null && (pred.task.id === activeId || succ.task.id === activeId);
        // Fan the landing Y around the bar midpoint: -(n-1)/2 .. +(n-1)/2 steps.
        const fanY = (i - (n - 1) / 2) * FAN_STEP;
        const d = orthogonalArrowPath(
          { x: pred.x + pred.w, y: pred.y + BAR_HEIGHT / 2 },
          { x: succ.x,          y: succ.y + BAR_HEIGHT / 2 + fanY },
        );
        const label = link.type !== 'FS' || (link.lagDays ?? 0) !== 0
          ? `${link.type}${link.lagDays ? (link.lagDays > 0 ? `+${link.lagDays}` : `${link.lagDays}`) : ''}`
          : '';
        out.push({ id: `${pred.task.id}->${succ.task.id}`, d, critical: criticalBoth, connected, label, labelX: succ.x - CLEARANCE - 2, labelY: succ.y + BAR_HEIGHT / 2 + fanY });
      });
    }
```
(Replace the existing `for...of` loop body accordingly; add `label`/`labelX`/`labelY` to the `out` element type; import `CLEARANCE` from `../../utils/ganttArrowPath` alongside `orthogonalArrowPath`.)

In the SVG render (lines ~1145-1170), raise the resting stroke so arrows aren't faint, and draw the label for non-default links. Change `strokeWidth={emphasized ? 1.75 : 1.25}` to `strokeWidth={emphasized ? 2 : 1.5}`, and after the `<AnimatedPath>` add (inside the same `.map`, wrap the return in a fragment):
```tsx
                  return (
                    <React.Fragment key={dep.id}>
                      <AnimatedPath
                        d={dep.d}
                        stroke={stroke}
                        strokeWidth={emphasized ? 2 : 1.5}
                        strokeOpacity={dimmed ? 0.2 : 0.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray={animate ? '4 3' : undefined}
                        strokeDashoffset={animate ? (dashOffset as unknown as number) : 0}
                        fill="none"
                        markerEnd={`url(#${dep.critical ? 'gantt-head-crit' : 'gantt-head'})`}
                      />
                      {dep.label && !dimmed ? (
                        <SvgText x={dep.labelX} y={dep.labelY - 3} fill={stroke} fontSize={8} fontWeight="700" textAnchor="end">{dep.label}</SvgText>
                      ) : null}
                    </React.Fragment>
                  );
```
Import `Text as SvgText` from `react-native-svg` (and `React` if not already imported for `Fragment`). The label shows e.g. `SS`, `FS+3`, `FF-1` only for non-default links (plain FS+0 stays clean).

- [ ] **Step 6: Wire the validator into `package.json` + verify + commit**

Add `"test:gantt-arrow": "bun run scripts/validate-gantt-arrow.ts",` and append `&& bun run test:gantt-arrow` to `ship-check`.
Run: `bun run scripts/validate-gantt-arrow.ts` → `7 passed`. Run: `npx tsc --noEmit` → clean. Run: `bun run lint` → 0 errors, no new warnings in `InteractiveGantt.tsx`.
```bash
git add utils/ganttArrowPath.ts scripts/validate-gantt-arrow.ts components/schedule/InteractiveGantt.tsx package.json
git commit -m "feat(scheduler): crisp MS-Project dependency arrows — wider routing, fanned heads, non-default link labels"
```

---

### Task 2: Plan / Track / Share desktop menu bar

**Files:**
- Create: `components/schedule/SchedulerMenuBar.tsx`
- Modify: `components/schedule/SchedulerTabShell.tsx`
- Modify: `app/schedule-pro.tsx`
- Modify: `components/schedule/tabs/GanttTab.tsx`

**Context:** Today `SchedulerTabShell` renders a horizontal 6-tab strip (`TABS`, lines 45-52) with `active` state (`useState<SchedulerTabKey>('overview')`, line 102) and `renderTab` (240-324). `schedule-pro` renders its own toolbar (AI · Health · Undo · Redo · Export · More, lines 1407-1418) and a `More` overflow modal (lines 1710-1726) whose items call handlers: `setShowVoice(true)`, `showCpmAnalysis()`, `handleReflow()`, `openWeatherReschedule()`, `setShowClosures(true)`, `setShowBaselineManager(true)`, `router.push('/schedule-import…')`, `setShowSettings(true)`. Export = `setExportSheetOpen(true)`, Share = `handleShare`, AI = `setShowAI(true)`, Add = `handleAddTask`, Baseline = `setShowBaselineManager(true)`, Health = `setShowHealth(true)`.

- [ ] **Step 1: Create `SchedulerMenuBar.tsx`**

A menu bar of three dropdown menus that merge view switching with actions. Model the dropdown on the existing `moreSheet` pattern (backdrop `Pressable` + absolutely-positioned `surface` sheet). Complete component:
```tsx
// components/schedule/SchedulerMenuBar.tsx — Plan / Track / Share menu bar.
// Replaces the 6-tab strip + the toolbar's More overflow with one grouped
// desktop-menubar grammar. View items switch the active tab; action items call
// handlers owned by schedule-pro (passed via `actions`).
import { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { SchedulerTabKey } from './SchedulerTabShell';

export interface SchedulerActions {
  onAddTask: () => void; onImport: () => void; onReflow: () => void; onClosures: () => void;
  onCriticalPath: () => void; onBaseline: () => void; onWeather: () => void;
  onExport: () => void; onShare: () => void; onAI: () => void;
}
type Item = { label: string; view?: SchedulerTabKey; action?: keyof SchedulerActions; divider?: boolean };
const MENUS: { key: string; label: string; items: Item[] }[] = [
  { key: 'plan', label: 'Plan', items: [
    { label: 'Timeline', view: 'timeline' }, { label: 'List', view: 'list' }, { label: 'Board', view: 'board' },
    { label: '', divider: true },
    { label: 'Add task', action: 'onAddTask' }, { label: 'Import', action: 'onImport' },
    { label: 'Re-plan', action: 'onReflow' }, { label: 'Closures', action: 'onClosures' },
  ]},
  { key: 'track', label: 'Track', items: [
    { label: 'Overview', view: 'overview' }, { label: 'Workload', view: 'workload' }, { label: 'Calendar', view: 'calendar' },
    { label: '', divider: true },
    { label: 'Critical path', action: 'onCriticalPath' }, { label: 'Baseline', action: 'onBaseline' }, { label: 'Weather re-plan', action: 'onWeather' },
  ]},
  { key: 'share', label: 'Share', items: [
    { label: 'Export', action: 'onExport' }, { label: 'Share link', action: 'onShare' }, { label: 'AI assist', action: 'onAI' },
  ]},
];

export function SchedulerMenuBar({ active, onSelectView, actions }: {
  active: SchedulerTabKey; onSelectView: (k: SchedulerTabKey) => void; actions: SchedulerActions;
}) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState<string | null>(null);
  const activeMenu = MENUS.find(m => m.items.some(i => i.view === active));
  return (
    <View style={styles.bar}>
      {MENUS.map(menu => {
        const isActiveGroup = activeMenu?.key === menu.key;
        return (
          <View key={menu.key}>
            <Pressable onPress={() => setOpen(menu.key)} style={styles.menuBtn} hitSlop={4}>
              <Text style={[styles.menuLabel, isActiveGroup && styles.menuLabelActive]}>{menu.label} ▾</Text>
            </Pressable>
            <Modal visible={open === menu.key} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
              <Pressable style={styles.backdrop} onPress={() => setOpen(null)} />
              <View style={styles.dropdown}>
                {menu.items.map((it, idx) => it.divider ? (
                  <View key={`d${idx}`} style={styles.divider} />
                ) : (
                  <Pressable key={it.label} style={styles.item}
                    onPress={() => {
                      setOpen(null);
                      if (it.view) onSelectView(it.view);
                      else if (it.action) actions[it.action]();
                    }}>
                    <Text style={[styles.itemText, it.view === active && styles.itemTextActive]}>{it.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Modal>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  bar: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, backgroundColor: t.surface },
  menuBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: Tokens.radius.sm },
  menuLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textSecondary },
  menuLabelActive: { color: t.accent },
  backdrop: { flex: 1, backgroundColor: t.overlay },
  dropdown: { position: 'absolute', top: 96, left: 12, minWidth: 200, backgroundColor: t.surface, borderRadius: Tokens.radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingVertical: 6 },
  item: { paddingHorizontal: 14, paddingVertical: 10 },
  itemText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  itemTextActive: { color: t.accent },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: 4 },
});
```
(If `t.overlay` doesn't exist, keep the `?? 'rgba(...)'` fallback — but prefer an existing token if the codebase has one for modal backdrops.)

- [ ] **Step 2: Swap the tab strip for the menu bar in `SchedulerTabShell.tsx`**

Add `actions: SchedulerActions;` to `SchedulerTabShellProps` (import the type from `./SchedulerMenuBar`). Replace the desktop tab strip render (the horizontal `ScrollView` of `TABS`) with:
```tsx
<SchedulerMenuBar active={active} onSelectView={setActive} actions={props.actions} />
```
Keep `TABS`, `renderTab`, and `active` — they're still used (the phone bar in Task 3 still references `TABS`, and `renderTab` still renders the body). Leave the `calendar` `soon` handling in `renderTab` as-is.

- [ ] **Step 3: Pass `actions` from `schedule-pro.tsx`; delete the `More` overflow**

In the `<SchedulerTabShell .../>` mount, add:
```tsx
actions={{
  onAddTask: handleAddTask,
  onImport: () => router.push(`/schedule-import?projectId=${project.id}`),
  onReflow: handleReflow,
  onClosures: () => setShowClosures(true),
  onCriticalPath: showCpmAnalysis,
  onBaseline: () => setShowBaselineManager(true),
  onWeather: openWeatherReschedule,
  onExport: () => setExportSheetOpen(true),
  onShare: handleShare,
  onAI: () => setShowAI(true),
}}
```
Delete the `More` overflow `Modal` (lines ~1710-1726), the `moreOpen` state (line 192), and the `More` `HeaderBtn` (line 1418). The toolbar keeps `AI · Health · Undo · Redo · Export`. (`showCpmAnalysis`, `handleReflow`, `openWeatherReschedule`, `handleShare`, `handleAddTask` all already exist.)

- [ ] **Step 4: Drop `'grid'` from the Timeline layout set in `GanttTab.tsx`**

`List` is now the canonical spreadsheet. In the layout segmented control (lines 232-245) change the array to `(['split', 'gantt', 'lanes', 'living'] as GanttPaneMode[])`, and remove the `if (layout === 'grid')` full-grid branch from `body` (lines ~150-166). Keep `'split'` as the default. `GanttPaneMode` keeps `'grid'` in its union (harmless) so `initialLayout` typing is unaffected.

> **Design note (deviation from spec):** the spec suggested surfacing the layout switcher in `SchedulerHeader`. We keep it in the Timeline body (`GanttTab`) where it already lives — it's still one click and only shows when Timeline is active, and relocating it into the header adds cross-component wiring risk for a blind build with no user-visible benefit. Revisit only if the header placement is explicitly wanted.

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` → clean. Run: `bun run lint` → 0 errors, no new warnings.
```bash
git add components/schedule/SchedulerMenuBar.tsx components/schedule/SchedulerTabShell.tsx app/schedule-pro.tsx components/schedule/tabs/GanttTab.tsx
git commit -m "feat(scheduler): Plan/Track/Share menu bar replaces tab strip + More overflow; List is canonical grid"
```

---

### Task 3: Mobile Plan / Track / Share Menu sheet

**Files:**
- Modify: `components/schedule/SchedulerTabShell.tsx`

**Context:** The phone `PhoneTabBar` (lines 166-238) shows a bottom bar of `VISIBLE` (Timeline · Board · Overview) + a `⋯ More` button opening an `overflowOpen` `Modal` that lists `OVERFLOW` (list, calendar, workload). Goal: keep the 3 bottom views, rename `More`→`Menu`, and make the sheet show the **same Plan/Track/Share taxonomy** as desktop (views + the shared actions), so the mental model matches across surfaces.

- [ ] **Step 1: Rename the phone `⋯ More` button to `Menu`**

In `PhoneTabBar`, change the overflow button's icon/label to `⋯ Menu` (the button that sets `overflowOpen`).

- [ ] **Step 2: Rebuild the phone sheet with Plan/Track/Share sections**

Replace the `OVERFLOW.map(...)` body of the overflow `Modal` (lines ~215-234) with grouped sections that mirror the desktop menus — views call `onChange(key)` (the existing tab setter), actions call the `actions` handlers (thread `actions` into `PhoneTabBar` from the shell props). Sections:
```tsx
<Text style={styles.overflowGroup}>Plan</Text>
<SheetRow label="List" onPress={() => { onChange('list'); close(); }} />
<SheetRow label="Add task" onPress={() => { actions.onAddTask(); close(); }} />
<SheetRow label="Import" onPress={() => { actions.onImport(); close(); }} />
<Text style={styles.overflowGroup}>Track</Text>
<SheetRow label="Workload" onPress={() => { onChange('workload'); close(); }} />
<SheetRow label="Calendar · soon" onPress={() => { onChange('calendar'); close(); }} />
<SheetRow label="Critical path" onPress={() => { actions.onCriticalPath(); close(); }} />
<SheetRow label="Baseline" onPress={() => { actions.onBaseline(); close(); }} />
<Text style={styles.overflowGroup}>Share</Text>
<SheetRow label="Export" onPress={() => { actions.onExport(); close(); }} />
```
where `close = () => setOverflowOpen(false)`, `SheetRow` reuses the existing `overflowItem`/`overflowText` styles, and `overflowGroup` is a new small uppercase label style (`Type.caption2`, `t.textSecondary`, tokens only). Pass `actions` from the shell into `PhoneTabBar` (add it to the `PhoneTabBar` props and the two call sites).

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` → clean. Run: `bun run lint` → 0 errors, no new warnings.
```bash
git add components/schedule/SchedulerTabShell.tsx
git commit -m "feat(scheduler): phone Menu sheet mirrors desktop Plan/Track/Share taxonomy"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → clean.
- [ ] `bun run lint` → 0 errors; no new warnings in touched files.
- [ ] `bun run scripts/validate-gantt-arrow.ts` → `7 passed, 0 failed`.
- [ ] `bun run ship-check` → passes end-to-end (includes new `test:gantt-arrow`).
- [ ] **Owner visual review at merge:** Timeline arrows read crisp (stepped routing, fanned heads, `SS`/`FS+3` labels on non-default links); the top shows **Plan ▾ / Track ▾ / Share ▾** with correct dropdown contents; no old tab strip or `More` button; the Timeline layout control shows Split/Gantt/Lanes/Living (no Grid); phone bottom bar has a `Menu` sheet grouped Plan/Track/Share.

## Out of scope (Increment 2 — separate plan)
Outline authoring (indent/outdent + drag-to-reorder + summary bars), the row/bar context menu, and the printable fit-to-page Gantt one-pager.
