# Pro Scheduler Phase 1 — Front Door + Coherent Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web/desktop Pro scheduler easy for a normal human — an obvious front door for empty schedules and one coherent, plain-language shell instead of a 40-control cockpit.

**Architecture:** Presentation & information-architecture only. A new pure `scheduleVerdict()` function turns existing CPM/baseline numbers into a plain-language verdict. A new `ScheduleOnRamp` component replaces the cockpit when there are zero tasks. The two competing view-switchers collapse into one tab set, with the Timeline tab owning all five layout modes (Grid/Split/Gantt/Lanes/Living) via render-props so `schedule-pro`'s existing data-fetching for Lanes/Living stays untouched. The 17-button toolbar groups into ~5 primary controls + a "More" overflow, and the duplicated header identity/actions are de-duped. **The CPM engine (`utils/cpm.ts`), offline queue, and persistence are not touched.**

**Tech Stack:** React Native / Expo (web + native), TypeScript strict, `bun`, `expo lint` (anti-slop `no-restricted-syntax`: use `Colors`/`Type`/`Tokens` design tokens, no hex / inline `fontSize` / `borderRadius` literals), `useThemedStyles(makeStyles)`, `lucide-react-native` icons, amber accent. No jest — pure functions are validated by `scripts/validate-*.ts` wired into the `ship-check` `&&`-chain.

**Verification note (visual QA):** The desktop Pro screen only renders above `GRID_BREAKPOINT = 900` (below it, `schedule-pro` shows a "Best on a bigger screen" fallback). The iOS simulator is a phone (<900px) and Claude cannot authenticate to the web app, so **UI changes here cannot be visually verified by Claude** — automated gates are `tsc` + `lint` + the verdict validator; the **owner verifies visuals at merge**. Keep every change blind-safe (no data-model risk).

---

## File Structure

**New files**
- `utils/scheduleVerdict.ts` — pure: CPM/baseline numbers → `{ tone, headline, detail }`. No React, no I/O.
- `scripts/validate-schedule-verdict.ts` — pure-fn validator for the above (no jest). Wired into `ship-check`.
- `components/schedule/ScheduleOnRamp.tsx` — the first-run front-door card. Pure presentation; all navigation via injected callbacks.

**Modified files**
- `app/schedule-pro.tsx` (1944 lines) — on-ramp branch; remove the top-toolbar pane toggle + `paneModeNonce`; pass Lanes/Living as render-props into the shell; group the toolbar into primary + "More"; consolidate export; drop the `Demo` button.
- `components/schedule/SchedulerTabShell.tsx` — rename tab keys (`dashboard→overview`, `gantt→timeline`), reorder, default `overview`; remove the `paneModeNonce` effect; pass `renderLanes`/`renderLiving` through to the Timeline tab.
- `components/schedule/tabs/GanttTab.tsx` — own the layout switcher (Grid/Split/Gantt/Lanes/Living) as local state; render Lanes/Living via the render-props.
- `components/schedule/tabs/DashboardTab.tsx` — reframe as **Overview**: verdict banner, honest tiles, real-or-empty EV chart (delete the fake polylines), advanced-metrics disclosure.
- `components/schedule/SchedulerHeader.tsx` — remove duplicate title + Add-Task + Export; lead with a compact verdict chip.
- `package.json` — add `test:schedule-verdict` script + append to `ship-check`.

**Task order:** 1 (verdict fn) → 2 (on-ramp) → 3 (Overview) → 4 (view-switcher unification) → 5 (toolbar grouping) → 6 (header de-dup). Each task is independently shippable, type-checks clean, and is committed on its own.

---

### Task 1: Pure `scheduleVerdict()` + validator

**Files:**
- Create: `utils/scheduleVerdict.ts`
- Create: `scripts/validate-schedule-verdict.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write the failing validator**

Create `scripts/validate-schedule-verdict.ts`:

```ts
// scripts/validate-schedule-verdict.ts — pure-fn validator for utils/scheduleVerdict.ts.
// Run via `bun run scripts/validate-schedule-verdict.ts`. No jest in this repo.
import { scheduleVerdict } from '../utils/scheduleVerdict';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

// On pace, no issues.
const onPace = scheduleVerdict({ slipDaysVsBaseline: 0, finishDateLabel: 'Aug 14, 2026', overdueCount: 0 });
expect('onPace tone', onPace.tone, 'onPace');
expect('onPace headline', onPace.headline, 'On pace — finishing about Aug 14, 2026');
expect('onPace detail empty', onPace.detail, '');

// Slightly behind (1..3) + driver + overdue.
const sb = scheduleVerdict({ slipDaysVsBaseline: 3, finishDateLabel: 'Sep 2, 2026', criticalDriverTitle: 'Electrical rough-in', overdueCount: 2 });
expect('slightlyBehind tone', sb.tone, 'slightlyBehind');
expect('slightlyBehind headline', sb.headline, '3 days behind plan — finishing about Sep 2, 2026');
expect('slightlyBehind detail', sb.detail, 'Electrical rough-in is your finish-date driver. 2 tasks overdue.');

// Behind (>=4), no finish date known.
const behind = scheduleVerdict({ slipDaysVsBaseline: 7, finishDateLabel: '—', overdueCount: 0 });
expect('behind tone', behind.tone, 'behind');
expect('behind headline (no finish)', behind.headline, '7 days behind plan');

// Ahead (singular day).
const ahead = scheduleVerdict({ slipDaysVsBaseline: -1, finishDateLabel: 'Jul 1, 2026', overdueCount: 0 });
expect('ahead tone', ahead.tone, 'ahead');
expect('ahead headline (singular)', ahead.headline, '1 day ahead of plan — finishing about Jul 1, 2026');

// No baseline set, but we know a finish date.
const nb = scheduleVerdict({ slipDaysVsBaseline: null, finishDateLabel: 'Aug 14, 2026', overdueCount: 0 });
expect('noBaseline tone', nb.tone, 'noBaseline');
expect('noBaseline headline', nb.headline, 'On track to finish about Aug 14, 2026');

// No baseline, no finish, overdue-only detail.
const nbEmpty = scheduleVerdict({ slipDaysVsBaseline: null, finishDateLabel: '—', overdueCount: 1 });
expect('noBaseline no-finish headline', nbEmpty.headline, 'Schedule in progress');
expect('overdue-only detail (singular)', nbEmpty.detail, '1 task overdue.');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run scripts/validate-schedule-verdict.ts`
Expected: FAIL — `Cannot find module '../utils/scheduleVerdict'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `utils/scheduleVerdict.ts`**

```ts
// utils/scheduleVerdict.ts — pure plain-language schedule verdict. No React, no I/O.
// Turns CPM/baseline outputs into a one-line human verdict for the Overview tab
// and a compact chip in the header. Covered by scripts/validate-schedule-verdict.ts.

export type VerdictTone = 'onPace' | 'ahead' | 'slightlyBehind' | 'behind' | 'noBaseline';

export interface VerdictInput {
  /** Days behind the saved baseline. null = no baseline set. Negative = ahead. */
  slipDaysVsBaseline: number | null;
  /** Preformatted finish date, e.g. "Aug 14, 2026", or "—" when unknown. */
  finishDateLabel: string;
  /** Title of the task currently driving the finish date, if any. */
  criticalDriverTitle?: string;
  /** Count of not-done tasks past their deadline. */
  overdueCount: number;
}

export interface ScheduleVerdict {
  tone: VerdictTone;
  headline: string;
  detail: string;
}

const hasFinish = (label: string) => {
  const t = label.trim();
  return t.length > 0 && t !== '—';
};

const dayWord = (n: number) => (Math.abs(n) === 1 ? 'day' : 'days');

/** Pure: map CPM/baseline numbers to a plain-language verdict. */
export function scheduleVerdict(input: VerdictInput): ScheduleVerdict {
  const { slipDaysVsBaseline: slip, finishDateLabel, criticalDriverTitle, overdueCount } = input;
  const finishClause = hasFinish(finishDateLabel) ? ` — finishing about ${finishDateLabel}` : '';

  let tone: VerdictTone;
  let headline: string;
  if (slip == null) {
    tone = 'noBaseline';
    headline = hasFinish(finishDateLabel)
      ? `On track to finish about ${finishDateLabel}`
      : 'Schedule in progress';
  } else if (slip <= -1) {
    tone = 'ahead';
    headline = `${Math.abs(slip)} ${dayWord(slip)} ahead of plan${finishClause}`;
  } else if (slip === 0) {
    tone = 'onPace';
    headline = `On pace${finishClause}`;
  } else if (slip <= 3) {
    tone = 'slightlyBehind';
    headline = `${slip} ${dayWord(slip)} behind plan${finishClause}`;
  } else {
    tone = 'behind';
    headline = `${slip} ${dayWord(slip)} behind plan${finishClause}`;
  }

  const parts: string[] = [];
  if (criticalDriverTitle && criticalDriverTitle.trim()) {
    parts.push(`${criticalDriverTitle.trim()} is your finish-date driver.`);
  }
  if (overdueCount > 0) {
    parts.push(`${overdueCount} task${overdueCount === 1 ? '' : 's'} overdue.`);
  }

  return { tone, headline, detail: parts.join(' ') };
}
```

- [ ] **Step 4: Run the validator to verify it passes**

Run: `bun run scripts/validate-schedule-verdict.ts`
Expected: PASS — `14 passed, 0 failed`.

- [ ] **Step 5: Wire into `package.json`**

Add a script alongside the other `test:*` entries:
```json
"test:schedule-verdict": "bun run scripts/validate-schedule-verdict.ts",
```
Append to the end of the `ship-check` chain (after `&& bun run test:cost-xray`):
```
 && bun run test:schedule-verdict
```

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit`  → Expected: no errors.
```bash
git add utils/scheduleVerdict.ts scripts/validate-schedule-verdict.ts package.json
git commit -m "feat(scheduler): pure scheduleVerdict() + validator wired into ship-check"
```

---

### Task 2: `ScheduleOnRamp` front-door component + first-run branch

**Files:**
- Create: `components/schedule/ScheduleOnRamp.tsx`
- Modify: `app/schedule-pro.tsx` (add the `workingTasks.length === 0` branch; add `dismissedOnRamp` state)

**Context:** `schedule-pro` derives `const workingTasks = hist.present;` (line 173). It already has two early returns — no project (1319) and too-narrow (1334). `handleLoadDemo` (796) loads the demo; the AI flow is `/generative-setup`, the wizard is `/schedule-wizard`; manual add opens the existing Add-Task modal via `handleAddTask`. `router` and `project` are in scope.

- [ ] **Step 1: Create the component**

Create `components/schedule/ScheduleOnRamp.tsx`:

```tsx
// components/schedule/ScheduleOnRamp.tsx — first-run front door for an empty
// schedule. Presentation only; all navigation is injected. Renders in place of
// the full scheduler cockpit when a project has zero tasks.
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Sparkles, LayoutTemplate, Plus } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';

export interface ScheduleOnRampProps {
  onBuildWithAI: () => void;
  onStartFromTemplate: () => void;
  onAddManually: () => void;
  onLoadExample: () => void;
}

export function ScheduleOnRamp({
  onBuildWithAI, onStartFromTemplate, onAddManually, onLoadExample,
}: ScheduleOnRampProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>Let’s build your schedule</Text>
        <Text style={styles.sub}>Start any way you like — you can change everything later.</Text>

        <TouchableOpacity style={styles.primary} onPress={onBuildWithAI} activeOpacity={0.85} testID="onramp-ai">
          <Sparkles size={18} color="#fff" />
          <Text style={styles.primaryText}>Build it from my estimate</Text>
          <Text style={styles.primaryBadge}>AI</Text>
        </TouchableOpacity>

        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.secondary} onPress={onStartFromTemplate} activeOpacity={0.85} testID="onramp-template">
            <LayoutTemplate size={16} color={t.accent} />
            <Text style={styles.secondaryText}>Start from a template</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={onAddManually} activeOpacity={0.85} testID="onramp-manual">
            <Plus size={16} color={t.accent} />
            <Text style={styles.secondaryText}>Add tasks manually</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={onLoadExample} hitSlop={8} testID="onramp-example">
          <Text style={styles.exampleLink}>Load an example schedule</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 520, alignItems: 'center',
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.border,
    padding: 28, gap: 14,
  },
  title: { fontSize: Type.title3.fontSize, fontWeight: '700', color: t.text },
  sub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.md,
    paddingVertical: 14, paddingHorizontal: 18, width: '100%',
  },
  primaryText: { fontSize: Type.body.fontSize, fontWeight: '700', color: '#fff' },
  primaryBadge: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.accent,
    backgroundColor: '#fff', borderRadius: Tokens.radius.xs, paddingHorizontal: 6, paddingVertical: 2,
  },
  secondaryRow: { flexDirection: 'row', gap: 10, width: '100%' },
  secondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.accent,
    paddingVertical: 12, paddingHorizontal: 12,
  },
  secondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
  exampleLink: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginTop: 4, textDecorationLine: 'underline' },
});
```

> Before writing: confirm `Type.title3`, `Type.body`, `Type.bodyCompact`, `Type.footnote`, `Type.caption2` and `Tokens.radius.{xs,md,lg}` exist in `constants/typography.ts` / `constants/designTokens.ts`. If a token is missing, use the nearest existing one (the file already uses `Type.subheadline`, `Type.bodyCompact`, `Tokens.radius.md`). Do **not** introduce raw literals — the anti-slop lint will fail.

- [ ] **Step 2: Add a `dismissedOnRamp` state to `schedule-pro.tsx`**

Near the other `useState` booleans (after line 208), add:
```tsx
const [dismissedOnRamp, setDismissedOnRamp] = useState(false);
```

- [ ] **Step 3: Add the first-run branch before the main render**

In `schedule-pro.tsx`, immediately **after** the too-narrow early return (ends line 1354) and **before** the `stats`/main `return` (line 1360), add:
```tsx
if (workingTasks.length === 0 && !dismissedOnRamp) {
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ChevronLeft size={20} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.headerBackText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
      </View>
      <ScheduleOnRamp
        onBuildWithAI={() => router.push({ pathname: '/generative-setup', params: { projectId: project.id } } as never)}
        onStartFromTemplate={() => router.push({ pathname: '/schedule-wizard', params: { projectId: project.id } } as never)}
        onAddManually={() => { setDismissedOnRamp(true); handleAddTask(); }}
        onLoadExample={handleLoadDemo}
      />
    </View>
  );
}
```
Add the import at the top of the file: `import { ScheduleOnRamp } from '@/components/schedule/ScheduleOnRamp';`

> Note: `handleAddTask` opens the Add-Task modal (it's the same callback passed to the shell as `onAddTask`). Confirm its name at the `onAddTask={handleAddTask}` mount (line 1555). The manual path sets `dismissedOnRamp` so the cockpit shows even while the first task is being entered.

- [ ] **Step 4: Remove the `Demo` button from the main toolbar**

Delete the toolbar `Demo` button (line 1423):
```tsx
<HeaderBtn icon={MageAIMark} label="Demo" onPress={handleLoadDemo} />
```
`handleLoadDemo` stays defined — it's now reached only via the on-ramp "Load an example" link (and can be exposed under `__DEV__` later if desired).

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` → no errors. Run: `bun run lint` → 0 errors (warnings from pre-existing files are fine; the new file must add none).
```bash
git add components/schedule/ScheduleOnRamp.tsx app/schedule-pro.tsx
git commit -m "feat(scheduler): first-run front door on-ramp; remove prod Demo button"
```

---

### Task 3: Reframe `DashboardTab` as the plain-language **Overview**

**Files:**
- Modify: `components/schedule/tabs/DashboardTab.tsx`

**Context:** `DashboardTab` reads `const { tasks, schedule, cpm } = useScheduler();`. It has a stat row (HEALTH SCORE / CRITICAL PATH / COST PERF.(CPI) / OVERDUE), a **fake** EV chart (hardcoded polylines, lines 94–102), a status donut, and a critical-path list. `cpm` here is `SchedulerContext.CpmResult` with `slipDaysVsBaseline`, `criticalPathDays`, `criticalTaskIds`.

- [ ] **Step 1: Add a verdict banner at the top of the scroll body**

Import the pure fn: `import { scheduleVerdict } from '@/utils/scheduleVerdict';`

Compute the verdict inside the component (after `const critical = ...`, line 44):
```tsx
const finishLabel = schedule.startDate
  ? new Date(new Date(schedule.startDate).getTime() + (schedule.totalDurationDays ?? 0) * 86400000)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';
// The finish-date driver = the last critical-path task (the one that ends the project).
const driverTitle = critical.length > 0 ? critical[critical.length - 1].title : undefined;
const verdict = scheduleVerdict({
  slipDaysVsBaseline: cpm.slipDaysVsBaseline ?? null,
  finishDateLabel: finishLabel,
  criticalDriverTitle: driverTitle,
  overdueCount: stats.overdue,
});
const verdictColor = verdict.tone === 'behind' ? Colors.pillLate
                   : verdict.tone === 'slightlyBehind' ? Colors.pillAtRisk
                   : verdict.tone === 'ahead' || verdict.tone === 'onPace' ? Colors.pillOnTrack
                   : Colors.textSecondary;
```

Render it as the first child inside the `ScrollView` (before the stat row, line 53):
```tsx
<View style={styles.verdictBanner}>
  <View style={[styles.verdictDot, { backgroundColor: verdictColor }]} />
  <View style={{ flex: 1 }}>
    <Text style={styles.verdictHeadline}>{verdict.headline}</Text>
    {verdict.detail ? <Text style={styles.verdictDetail}>{verdict.detail}</Text> : null}
  </View>
</View>
```

Add styles to the `StyleSheet` (use tokens, no literals):
```tsx
verdictBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.surface, borderRadius: 10, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
verdictDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
verdictHeadline: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: Colors.text },
verdictDetail: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, marginTop: 3 },
```
(If `Type` is not yet imported here, add `import { Type } from '@/constants/typography';`. Keep `borderRadius: 10` only if the file already uses numeric radii elsewhere — it does, e.g. `statCard`; otherwise switch to `Tokens.radius.md`.)

- [ ] **Step 2: Replace the dead `COST PERF. (CPI) —` tile with an honest budget tile**

Change the third `StatCard` (lines 67–72) from:
```tsx
<StatCard label="COST PERF. (CPI)" value="—" delta="Linked-budget feature coming soon" phone={isPhone} />
```
to:
```tsx
<StatCard label="BUDGET" value="Not linked" delta="Link an estimate to track cost" phone={isPhone} />
```

- [ ] **Step 3: Delete the fake Earned-Value chart; show real-or-honest-empty**

`DashboardTab` does not currently receive an EV snapshot. Rather than plumb one in Phase 1, replace the placeholder polyline block (lines 94–102) with an honest empty state so nothing fake ships:
```tsx
<View style={{ height: 140, alignItems: 'center', justifyContent: 'center' }}>
  <Text style={styles.chartHint}>Link a budget to see earned value</Text>
</View>
```
(The real EV chart already renders at the screen level via `EarnedValuePanel` when `evSnapshot.totalBudget > 0` — `schedule-pro.tsx:1444-1448` — so this tab does not need to duplicate it.)

- [ ] **Step 4: Plain-language relabel in the critical-path list**

In the critical-path list, change the `0d float` cell (line 144) from a raw jargon string to plain language:
```tsx
<Text style={styles.cpFloat}>no buffer</Text>
```
(Float-as-"can slip X days" is Phase 3; Phase 1 only removes the raw `0d float` jargon.)

> **Note on the spec's "Advanced metrics" disclosure:** the spec (Move 4) called for gating SPI/CPI/EVM behind an "Advanced metrics" toggle. Steps 2–3 above **remove** those from the Overview instead of hiding them, because none of that data is real in Phase 1 (EV/CPI require a linked budget). Removing beats a collapsible over fake data. The disclosure re-enters in a later phase once real earned-value data is wired. This is an intentional scope decision, not a gap.

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` → no errors. Run: `bun run lint` → no new warnings in this file.
```bash
git add components/schedule/tabs/DashboardTab.tsx
git commit -m "feat(scheduler): plain-language Overview — verdict banner, honest tiles, no fake EV chart"
```

---

### Task 4: Unify the view-switcher (one tab set; Timeline owns all 5 layouts)

**Files:**
- Modify: `components/schedule/SchedulerTabShell.tsx`
- Modify: `components/schedule/tabs/GanttTab.tsx`
- Modify: `app/schedule-pro.tsx`

**Context:** Two switchers compete today — the top-toolbar pane toggle (`schedule-pro.tsx:1388-1408`, values `grid|split|gantt|resources|living`) and the shell tab strip (`SchedulerTabShell.tsx:45-52`). Grid/Split/Gantt force the Gantt tab via `paneModeNonce` (`SchedulerTabShell.tsx:114-118`). Lanes (`ResourceSwimlanes`) and Living (`LivingFloorPlan`) render **outside** the shell (`schedule-pro.tsx:1491-1529`). Strategy: rename tabs, delete the nonce, move all 5 layout modes **into** the Timeline tab. To avoid moving Lanes/Living data-fetching, `schedule-pro` passes them as **render-props**.

- [ ] **Step 1: Rename tab keys + reorder + default in `SchedulerTabShell.tsx`**

Update the union type (`:34-40`):
```tsx
export type SchedulerTabKey =
  | 'overview'
  | 'timeline'
  | 'list'
  | 'board'
  | 'workload'
  | 'calendar';
```
Update `TABS` (`:45-52`):
```tsx
const TABS: { key: SchedulerTabKey; label: string; soon?: boolean }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'timeline',  label: 'Timeline' },
  { key: 'list',      label: 'List' },
  { key: 'board',     label: 'Board' },
  { key: 'workload',  label: 'Workload' },
  { key: 'calendar',  label: 'Calendar', soon: true },
];
```
Change the default (`:107`): `const [active, setActive] = useState<SchedulerTabKey>('overview');`
In `renderTab` (`:257-328`), rename the branch keys: `if (key === 'timeline')` (was `'gantt'`) and `if (key === 'overview')` returns `<DashboardTab />` (was `'dashboard'`).
In `PhoneTabBar` (`:186-191`), update `VISIBLE`/`OVERFLOW` keys: replace `'gantt'→'timeline'`, `'dashboard'→'overview'`.

- [ ] **Step 2: Delete the `paneModeNonce` effect**

Remove the effect (`SchedulerTabShell.tsx:114-118`) and the `paneModeNonce` prop from `SchedulerTabShellProps` (`:76`). The pane control now lives inside the Timeline tab, so there is nothing to force.

- [ ] **Step 3: Add render-prop pass-throughs for Lanes/Living**

In `SchedulerTabShellProps`, replace `ganttPaneMode`/`paneModeNonce` with:
```tsx
/** Initial Timeline layout mode. */
initialLayout?: GanttPaneMode;
/** Rendered by the Timeline tab when the user picks the Lanes layout. */
renderLanes?: () => ReactNode;
/** Rendered by the Timeline tab when the user picks the Living Plan layout. */
renderLiving?: () => ReactNode;
```
In `renderTab`, pass these into `<GanttTab ... initialLayout={props.initialLayout} renderLanes={props.renderLanes} renderLiving={props.renderLiving} />` (replacing the old `paneMode={props.ganttPaneMode ?? 'split'}`).

- [ ] **Step 4: Give `GanttTab` a local layout switcher + the two new modes**

In `components/schedule/tabs/GanttTab.tsx`:
- Extend the mode type: `export type GanttPaneMode = 'grid' | 'split' | 'gantt' | 'lanes' | 'living';`
- Replace the `paneMode` prop with `initialLayout?: GanttPaneMode` and add `renderLanes?: () => ReactNode;` `renderLiving?: () => ReactNode;` to `GanttTabProps`.
- Add local state: `const [layout, setLayout] = useState<GanttPaneMode>(initialLayout ?? 'split');`
- Render a small segmented control at the top of the non-phone return (immediately before `<View style={styles.row}>`, ~line 164):
```tsx
<View style={styles.layoutBar}>
  {(['grid','split','gantt','lanes','living'] as GanttPaneMode[]).map(m => (
    <Pressable key={m} onPress={() => setLayout(m)} style={[styles.layoutBtn, layout === m && styles.layoutBtnActive]} hitSlop={4}>
      <Text style={[styles.layoutBtnText, layout === m && styles.layoutBtnTextActive]}>{LAYOUT_LABEL[m]}</Text>
    </Pressable>
  ))}
</View>
```
with `const LAYOUT_LABEL: Record<GanttPaneMode, string> = { grid: 'Grid', split: 'Split', gantt: 'Gantt', lanes: 'Lanes', living: 'Living Plan' };` and `layoutBar`/`layoutBtn`/`layoutBtnActive`/`layoutBtnText`/`layoutBtnTextActive` styles using `Colors`/`Type`/`Tokens` (mirror the existing `paneBtn` styles from `schedule-pro.tsx:1921-1943`).
- Where the body renders: if `layout === 'lanes'` return `renderLanes?.() ?? null`; if `layout === 'living'` return `renderLiving?.() ?? null`; otherwise pass `paneMode={layout}` (now guaranteed `grid|split|gantt`) into the existing grid/split/gantt rendering. Keep the phone branch unchanged (it ignores layout).

- [ ] **Step 5: Update `schedule-pro.tsx` — remove the toolbar toggle + the top-level pane branch; pass render-props**

- Delete the pane toggle block (`:1388-1408`) from the toolbar.
- Delete the `paneMode === 'living' ? ... : paneMode === 'resources' ? ... : (` wrapper (`:1491-1529`) so the shell **always** renders; move the `ResourceSwimlanes` and `LivingFloorPlan` JSX into two functions passed as render-props.
- Simplify state: keep `const [paneMode, setPaneMode] = useState<PaneMode>(...)` only if still needed for `initialLayout`; delete `paneModeNonce` + `setPaneModeAndForceGantt` (`:184-188`).
- Update the `<SchedulerTabShell .../>` mount (`:1531`): remove `ganttPaneMode`/`paneModeNonce`; add:
```tsx
initialLayout={width >= SPLIT_BREAKPOINT ? 'split' : 'grid'}
renderLanes={() => (
  <View style={styles.body}><View style={styles.paneFull}>
    <ResourceSwimlanes tasks={rolledTasks} resources={project?.schedule?.resources} projectStartDate={projectStartDate} projectName={project?.name} />
  </View></View>
)}
renderLiving={() => {
  const planSheets = getPlanSheetsForProject(project.id).filter((s) => !s.superseded);
  const firstSheet = planSheets[0] ?? null;
  const zones = getPlanZonesForProject(project.id).filter((z) => firstSheet ? z.planSheetId === firstSheet.id : false);
  const pins = firstSheet ? getPinsForPlan(firstSheet.id) : [];
  const photos = getPhotosForProject(project.id);
  const photoById = (photoId: string) => { const p = photos.find((ph) => ph.id === photoId); return p ? { uri: p.uri, createdAt: p.createdAt } : undefined; };
  return (
    <View style={styles.body}><View style={styles.paneFull}>
      <LivingFloorPlan project={project} planSheetId={firstSheet?.id ?? ''} zones={zones} pins={pins} photoById={photoById} imageUri={firstSheet?.imageUri ?? ''} imageW={firstSheet?.width} imageH={firstSheet?.height} onEdit={() => setShowLivingPlanEditor(true)} onAddPlan={() => router.push('/plans' as never)} />
    </View></View>
  );
}}
```
(This is the exact JSX lifted verbatim from `:1491-1529`, so behavior is preserved — it just renders inside the Timeline tab now.)

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit` → no errors (the `SchedulerTabKey`/`GanttPaneMode`/prop renames must all line up). Run: `bun run lint` → no new warnings.
```bash
git add components/schedule/SchedulerTabShell.tsx components/schedule/tabs/GanttTab.tsx app/schedule-pro.tsx
git commit -m "feat(scheduler): one view-switcher — Timeline tab owns all 5 layouts; delete paneModeNonce hack"
```

---

### Task 5: Group the toolbar into primary + "More"; consolidate export

**Files:**
- Modify: `app/schedule-pro.tsx`
- Create (inline in the same file): a small `MoreMenu` popover component + `moreOpen` state.

**Context:** After Tasks 2/4 the toolbar row (`:1414-1438`) has lost `Demo` and the pane toggle. Remaining buttons: AI, Voice, Health badge, Reflow, Baseline, Import, CSV, iCal, PDF, Undo, Redo, CPM, Weather, Closures, Settings, Share. Goal: keep ~5 primary inline; move the rest into a grouped overflow. The `ExportSheet` (`:1719`) already offers CSV/iCal/PDF/Share, so one `Export` button opening it replaces the four separate export/share buttons.

- [ ] **Step 1: Reduce the primary toolbar row**

Replace the toolbar action cluster (`:1414-1438`) with the primary set only:
```tsx
<HeaderBtn icon={MageAIMark} label="AI" onPress={() => setShowAI(true)} highlighted />
<ScheduleHealthBadge result={healthScore} onPress={() => setShowHealth(true)} size="compact" />
<HeaderBtn icon={Undo2} label="Undo" onPress={handleUndo} disabled={!canUndo(hist)} />
<HeaderBtn icon={Redo2} label="Redo" onPress={handleRedo} disabled={!canRedo(hist)} />
<HeaderBtn icon={Download} label="Export" onPress={() => setExportSheetOpen(true)} />
<HeaderBtn icon={MoreHorizontal} label="More" onPress={() => setMoreOpen(true)} />
```
(`＋ Add Task` continues to render once — via `SchedulerHeader` today; Task 6 confirms it stays there. Import `MoreHorizontal` from `lucide-react-native`.)

- [ ] **Step 2: Add `moreOpen` state + the grouped overflow menu**

Add `const [moreOpen, setMoreOpen] = useState(false);` with the other booleans. First, extract the existing CPM-analysis `Alert` (`:1429-1433`) into a named callback so the menu can call it:
```tsx
const showCpmAnalysis = useCallback(() => {
  const msg = `Project finish: day ${cpm.projectFinish}\nCritical path: ${cpm.criticalPath.length} task(s)\nConflicts: ${cpm.conflicts.length}`;
  if (Platform.OS === 'web') window.alert?.(msg);
  else Alert.alert('Schedule analysis', msg);
}, [cpm]);
```
Then mount a grouped overflow menu at the end of the render (near the other modals/sheets, e.g. beside `ExportSheet` at `:1719`). Model it on `SchedulerTabShell.tsx:224-252` (transparent `Modal` + backdrop + a `surface` sheet). Complete code:
```tsx
<Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
  <Pressable style={styles.moreBackdrop} onPress={() => setMoreOpen(false)} />
  <View style={styles.moreSheet}>
    <Text style={styles.moreGroupLabel}>Analyze</Text>
    <MoreItem label="Voice input"      onPress={() => { setMoreOpen(false); setShowVoice(true); }} />
    <MoreItem label="Critical path"    onPress={() => { setMoreOpen(false); showCpmAnalysis(); }} />
    <MoreItem label="Re-plan (Reflow)" onPress={() => { setMoreOpen(false); handleReflow(); }} />
    <MoreItem label="Weather re-plan"  onPress={() => { setMoreOpen(false); openWeatherReschedule(); }} />
    <MoreItem label="Closures"         onPress={() => { setMoreOpen(false); setShowClosures(true); }} />
    <MoreItem label="Original plan (Baseline)" onPress={() => { setMoreOpen(false); setShowBaselineManager(true); }} />
    <Text style={styles.moreGroupLabel}>Manage</Text>
    <MoreItem label="Import"   onPress={() => { setMoreOpen(false); router.push(`/schedule-import?projectId=${project.id}`); }} />
    <MoreItem label="Settings" onPress={() => { setMoreOpen(false); setShowSettings(true); }} />
  </View>
</Modal>
```
Add a small `MoreItem` helper near `HeaderBtn`/`PaneBtn` (`:1784`):
```tsx
function MoreItem({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity onPress={onPress} style={styles.moreItem} activeOpacity={0.7}>
      <Text style={styles.moreItemText}>{label}</Text>
    </TouchableOpacity>
  );
}
```
Add styles to `makeStyles` (tokens only):
```tsx
moreBackdrop: { flex: 1, backgroundColor: t.overlay },
moreSheet: { position: 'absolute', top: 64, right: 16, minWidth: 220, backgroundColor: t.surface, borderRadius: Tokens.radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingVertical: 6 },
moreGroupLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textSecondary, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2, letterSpacing: 0.6 },
moreItem: { paddingHorizontal: 14, paddingVertical: 10 },
moreItemText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
```
(The plain-language menu labels — "Re-plan (Reflow)", "Original plan (Baseline)" — satisfy the spec's jargon→plain mapping for these actions. If `t.overlay` doesn't exist, use the existing backdrop color the codebase uses for modals.)

- [ ] **Step 3: Remove the now-redundant separate export buttons**

Confirm the standalone `CSV`, `iCal`, `PDF`, `Share` `HeaderBtn`s are gone from the toolbar (folded into `Export`→`ExportSheet`). Their handlers (`handleExportCsv`, `handleExportIcs`, `handleExportPdf`, `handleShare`) stay defined — `ExportSheet` calls them (`:1722-1732`).

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit` → no errors. Run: `bun run lint` → no new warnings.
```bash
git add app/schedule-pro.tsx
git commit -m "feat(scheduler): group toolbar into primary + More overflow; single Export entry"
```

---

### Task 6: De-dupe `SchedulerHeader` + compact verdict chip

**Files:**
- Modify: `components/schedule/SchedulerHeader.tsx`

**Context:** `SchedulerHeader` (desktop branch `:110-153`) renders the project **title** again (`:113`), a `＋ Add Task` button (`:144-148`, gated on `onAddTaskPress`), and an `Export` button (`:149-151`) — all duplicated with `schedule-pro`'s custom header. It also shows the KPI strip and BASELINE/VIEW pickers. Keep the KPI rail + pickers; drop the duplicated identity/actions; lead with a compact verdict.

- [ ] **Step 1: Remove the duplicate title row**

Delete the `titleRow` block (`:112-115`) and the `subtitle` line (`:116-118`) from the **desktop** return — `schedule-pro`'s custom header is the single identity row. (Leave the phone branch `:78-89` as-is; phone is a separate track.)

- [ ] **Step 2: Remove the duplicate Add-Task + Export buttons**

Delete the `onAddTaskPress` button (`:144-148`) and the `Export` button (`:149-151`). Remove `onAddTaskPress` from `SchedulerHeaderProps` (`:28-29`) and drop it where the shell passes it (`SchedulerTabShell.tsx:167` `onAddTaskPress={props.onAddTask}` — remove that line). The header keeps the BASELINE + VIEW pickers.

- [ ] **Step 3: Lead the KPI strip with a compact verdict chip**

Import the pure fn: `import { scheduleVerdict } from '@/utils/scheduleVerdict';`. Compute a compact verdict (finish + tone) using the same inputs already derived in the header (`finishDate`, `cpm.slipDaysVsBaseline`, `overdueCount`; the header has no critical-driver title, so omit it — the compact chip shows only tone + finish):
```tsx
const v = scheduleVerdict({
  slipDaysVsBaseline: cpm.slipDaysVsBaseline ?? null,
  finishDateLabel: finishDate,
  overdueCount,
});
const vColor = v.tone === 'behind' ? Colors.pillLate
             : v.tone === 'slightlyBehind' ? Colors.pillAtRisk
             : v.tone === 'ahead' || v.tone === 'onPace' ? Colors.pillOnTrack
             : Colors.textSecondary;
```
Render a compact chip as the first child of `styles.kpiStrip` (before the `START` Kpi, `:121`):
```tsx
<View style={styles.verdictChip}>
  <View style={[styles.verdictChipDot, { backgroundColor: vColor }]} />
  <Text style={styles.verdictChipText} numberOfLines={1}>{v.headline}</Text>
</View>
```
Add styles (tokens only):
```tsx
verdictChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 8 },
verdictChipDot: { width: 8, height: 8, borderRadius: 4 },
verdictChipText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.text, maxWidth: 240 },
```
The full headline+detail banner remains only in the Overview tab (Task 3), so the two never show the same sentence.

- [ ] **Step 4: Relabel `Crit Path` chip (phone) to plain language**

In the phone chip rail (`:104`), change `<KpiChip label="Crit Path" value={...} />` label to `"Finish driver"`. (Desktop KPI rail has no `Crit Path` cell; no change needed there.)

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` → no errors (removing `onAddTaskPress` must be reflected in both the props type and the shell mount). Run: `bun run lint` → no new warnings.
```bash
git add components/schedule/SchedulerHeader.tsx components/schedule/SchedulerTabShell.tsx
git commit -m "feat(scheduler): de-dupe header identity/actions; compact verdict chip"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → clean.
- [ ] `bun run lint` → 0 errors; no new warnings in the touched files.
- [ ] `bun run scripts/validate-schedule-verdict.ts` → `14 passed, 0 failed`.
- [ ] `bun run ship-check` → passes end-to-end (includes the new `test:schedule-verdict`).
- [ ] **Owner visual review at merge** (Claude cannot render the >900px Pro screen): empty project shows the on-ramp; a populated schedule shows one tab set (Overview default) with the Timeline layout switcher (Grid/Split/Gantt/Lanes/Living); the toolbar is ~5 controls + More; the title/Add/Export appear once; Overview leads with a plain-language verdict and no fake chart.

## Out of scope (later phases — do NOT build here)

- **Phase 2:** fluent grid editing (inline ghost row, Enter-down, paste-creates-rows, drag-reorder).
- **Phase 3:** "Fix overloads" leveling button, explained critical-path panel with float-as-"can slip X days", audit-log viewer.
- **Separate track:** phone/mobile scheduler redesign.
