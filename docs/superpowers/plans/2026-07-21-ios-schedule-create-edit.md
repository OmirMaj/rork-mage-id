# iOS Schedule Create + Edit (copilot-led) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the AI Schedule Builder and conversational + tap-to-edit editing to the iPhone schedule, so a schedule can be created and changed from the field in a tap or a sentence — every change landing through one reflow-preview → apply.

**Architecture:** Reuse the pure, surface-agnostic edit engine (`interpretScheduleOps` + `diffSchedule`) driven by `CopilotShell`/`scheduleEditCapability` through the `CopilotContext` seams `currentTasks`/`commitTasks`/`cpmOptions`. The only new logic is a pure `applyToProjectSchedule` that reflows start days (via `runCpm`) and returns a persist-ready `ProjectSchedule` for the classic mobile schedule (which reads `task.startDay` directly and never re-runs CPM at render). Mobile persists via `updateProject`; the existing desktop `commit()` path is untouched. The desktop `ScheduleEditPanel` component is reused verbatim on mobile with a mobile `commit`.

**Tech Stack:** React Native / Expo (New Arch, iOS-primary), TypeScript strict, `@/utils/cpm`, `@/utils/copilot/scheduleEdit/*`, `@/components/copilot/{CopilotShell,ScheduleEditPanel,ScheduleDiffView}`, `@/components/DatePickerModal`, `mageAI` (existing `ai` edge relay — no new backend).

---

## Repo conventions (read before starting)

- **bun**. Type-check `npx tsc --noEmit`. Lint `bun run lint` (anti-slop: `Colors`/`Type`/`Tokens` only — no raw hex, inline `fontSize`, or `borderRadius`; raw `padding`/`gap`/`width`/`minHeight` numbers OK). Full gate `bun run ship-check`.
- **No jest** — pure functions are tested with `scripts/validate-*.ts` files wired into the `ship-check` `&&`-chain in `package.json`. Convention (see `scripts/validate-copilot-diff-schedule.ts`): relative imports (`../utils/...`, `../types`), a tiny `ok(name, cond)` harness with `pass`/`fail` counters, footer `console.log(\`\n${pass} passed, ${fail} failed\`); if (fail) process.exit(1);`.
- **OTA-safe** — no new native module, no new edge function. Reuse the shipped `mageAI` → `ai` relay.
- **Verified real interfaces** (do not re-derive):
  - `ScheduleTask` (`@/types`): `{ id, title, phase, durationDays, startDay, progress, crew /*string*/, crewSize? /*number*/, dependencies: string[], dependencyLinks?, notes, status, isMilestone? }`.
  - `ProjectSchedule` (`@/types`): `{ name, startDate?, workingDaysPerWeek, tasks: ScheduleTask[], baseline?, baselines?, nonWorkingDates?, … }`.
  - `runCpm(tasks, options?)` → `CpmResult { perTask: Map<string, CpmTaskResult{ es /*1-indexed early start*/, ef, isCritical, … }>, projectFinish, … }`. It anchors each task's ES to `max(1, task.startDay)` then raises it to satisfy dependencies (`cpm.ts:515,522,544`). `RunCpmOptions = { scheduleStartDate?, workingDaysPerWeek?, nonWorkingDates?, taskCalendars?, criticalFloatThresholdDays?, levelResources? }`.
  - `scheduleEditCapability` id is `'scheduleEdit'`; its `apply` calls `ctx.commitTasks(producer)` where `producer(prev) = applyEditEffects(ops, interpretScheduleOps(ops, prev).nextTasks, ctx.cpmOptions)`; its `renderReview` renders `ScheduleDiffView` from `ctx.currentTasks`/`ctx.cpmOptions`.
  - `ScheduleEditPanel` props (`components/copilot/ScheduleEditPanel.tsx`): `{ visible, onClose, projectId, tasks: ScheduleTask[], commit: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => void, cpmOptions: RunCpmOptions }` — mounts `CopilotShell` with `capabilityId='scheduleEdit'` and `ctx={ project, projectId, ctx: projectsCtx, tier, commitTasks: commit, currentTasks: tasks, cpmOptions }`.
  - `DatePickerModal` props (`components/DatePickerModal.tsx`): `{ visible, value: string /*ISO*/, onClose, onChange: (iso: string) => void, title?, allowFuture? }`. `onChange` returns an ISO string at noon UTC.
  - Mobile persist shape (`app/(tabs)/schedule/index.tsx:260`): `updateProject(selectedProject.id, { schedule: { ...activeSchedule, ...patch, updatedAt: new Date().toISOString() } })`.
  - `/schedule-builder` route reads `projectId` param and renders `ScheduleBuilderInterview`; its Accept path stashes a draft → `schedule-review` → `updateProject`.

## File Structure

- **Create** `utils/copilot/scheduleEdit/applyToProjectSchedule.ts` — pure: reflow edited tasks → persist-ready `ProjectSchedule`. One responsibility; validator-tested.
- **Create** `scripts/validate-copilot-mobile-apply.ts` — pure-fn validator for the above.
- **Modify** `package.json` — add `test:copilot-mobile-apply` and chain it into `ship-check`.
- **Modify** `app/(tabs)/schedule/index.tsx` — (A) AI-builder entry in the create/empty state; (B) mount `ScheduleEditPanel` + a pinned copilot bar with a mobile `commit`; (C) surface Starts/Duration/Status with `DatePickerModal` in the task edit modal.
- **Modify** `components/schedule/ScheduleSettingsMenu.tsx` — swap the typed `YYYY-MM-DD` start-date input for `DatePickerModal`.
- **Modify** `app/schedule-pro.tsx` — add the same pinned copilot bar to the desktop scheduler (it already has `commit()`), for parity.

---

### Task 1: `applyToProjectSchedule` (pure) + validator — TDD

**Files:**
- Create: `utils/copilot/scheduleEdit/applyToProjectSchedule.ts`
- Create/Test: `scripts/validate-copilot-mobile-apply.ts`

- [ ] **Step 1: Write the failing validator**

Create `scripts/validate-copilot-mobile-apply.ts`:

```ts
// scripts/validate-copilot-mobile-apply.ts — pure-fn validator for applyToProjectSchedule.
import { applyToProjectSchedule } from '../utils/copilot/scheduleEdit/applyToProjectSchedule';
import type { ProjectSchedule, ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const mk = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
});
const sched = (tasks: ScheduleTask[], over: Partial<ProjectSchedule> = {}): ProjectSchedule =>
  ({ name: 'S', workingDaysPerWeek: 7, tasks, ...over } as ProjectSchedule);

// 1 — independent task keeps its start day (ES anchors to startDay floor)
{
  const s = sched([mk('a', { startDay: 5, durationDays: 3 })]);
  const out = applyToProjectSchedule(s, s.tasks, {});
  ok('independent task keeps its start day', out.tasks[0].startDay === 5);
}
// 2 — FS dependent reflows to predecessor finish + 1 (raw mode: a es1 ef3 → b es4)
{
  const tasks = [mk('a', { startDay: 1, durationDays: 3 }), mk('b', { startDay: 1, durationDays: 2, dependencies: ['a'] })];
  const out = applyToProjectSchedule(sched(tasks), tasks, {});
  ok('FS dependent reflows to predecessor finish + 1', out.tasks[1].startDay === 4);
}
// 3 — moving the predecessor later cascades the dependent (a es5 ef7 → b es8)
{
  const tasks = [mk('a', { startDay: 5, durationDays: 3 }), mk('b', { startDay: 1, durationDays: 2, dependencies: ['a'] })];
  const out = applyToProjectSchedule(sched(tasks), tasks, {});
  ok('moving predecessor cascades the dependent', out.tasks[0].startDay === 5 && out.tasks[1].startDay === 8);
}
// 4 — preserves non-task schedule fields
{
  const s = sched([mk('a')], { name: 'Henderson', startDate: '2026-03-01', workingDaysPerWeek: 5, baselines: [] as any });
  const out = applyToProjectSchedule(s, s.tasks, { workingDaysPerWeek: 5 });
  ok('preserves name/startDate/workingDaysPerWeek', out.name === 'Henderson' && out.startDate === '2026-03-01' && out.workingDaysPerWeek === 5);
  ok('preserves baselines sidecar', Array.isArray((out as any).baselines));
}
// 5 — does not mutate the input array
{
  const tasks = [mk('a', { startDay: 1, durationDays: 3 }), mk('b', { startDay: 1, dependencies: ['a'] })];
  const snapshot = tasks[1].startDay;
  applyToProjectSchedule(sched(tasks), tasks, {});
  ok('input tasks are not mutated', tasks[1].startDay === snapshot);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run scripts/validate-copilot-mobile-apply.ts`
Expected: FAIL — `Cannot find module '../utils/copilot/scheduleEdit/applyToProjectSchedule'` (the function does not exist yet).

- [ ] **Step 3: Implement the pure function**

Create `utils/copilot/scheduleEdit/applyToProjectSchedule.ts`:

```ts
// utils/copilot/scheduleEdit/applyToProjectSchedule.ts — pure. Reflow a schedule
// after a copilot/tap edit produced `editedTasks`, ready for updateProject on the
// classic mobile schedule (which reads task.startDay directly and does NOT re-run
// CPM at render). runCpm anchors each task's ES to its startDay floor and raises
// dependents; we write that ES back so successors visibly move. All other schedule
// fields are preserved. React/RN-free so the validator can drive it.
import type { ProjectSchedule, ScheduleTask } from '@/types';
import { runCpm, type RunCpmOptions } from '@/utils/cpm';

export function applyToProjectSchedule(
  schedule: ProjectSchedule,
  editedTasks: ScheduleTask[],
  cpmOptions: RunCpmOptions,
): ProjectSchedule {
  const cpm = runCpm(editedTasks, cpmOptions);
  const tasks = editedTasks.map(t => {
    const r = cpm.perTask.get(t.id);
    return r ? { ...t, startDay: r.es } : t;
  });
  return { ...schedule, tasks };
}
```

- [ ] **Step 4: Run the validator to verify it passes**

Run: `bun run scripts/validate-copilot-mobile-apply.ts`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils/copilot/scheduleEdit/applyToProjectSchedule.ts scripts/validate-copilot-mobile-apply.ts
git commit -m "copilot(schedule): pure applyToProjectSchedule (mobile reflow) + validator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire the validator into ship-check

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the script**

In `package.json` `scripts`, add next to the other `test:copilot-*` entries:

```json
"test:copilot-mobile-apply": "bun run scripts/validate-copilot-mobile-apply.ts",
```

- [ ] **Step 2: Chain it into ship-check**

In the `ship-check` value, append ` && bun run test:copilot-mobile-apply` immediately after `&& bun run test:copilot-schedule-builder` (keep it adjacent to the other copilot-schedule validators).

- [ ] **Step 3: Verify the chain runs it**

Run: `bun run test:copilot-mobile-apply`
Expected: `5 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: wire test:copilot-mobile-apply into ship-check

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3 (Part A): AI Schedule Builder entry on the mobile schedule

**Files:**
- Modify: `app/(tabs)/schedule/index.tsx`

- [ ] **Step 1: Find the create/empty state**

Run: `grep -nE "handleTemplateSelect|onLoadExample|empty|No schedule|Create|template|Quick Add|generative" "app/(tabs)/schedule/index.tsx" | head`
Expected: locate the empty-state / create options block (where templates + example are offered before a schedule exists).

- [ ] **Step 2: Add the AI-builder entry as the primary create option**

In the create/empty block, add a primary button (using `Colors`/`Type`/`Tokens`, matching the file's existing button styles — e.g. the template button) labeled **"Answer a few questions"** with an "AI" affordance, that navigates:

```tsx
import { useRouter } from 'expo-router';
// ...
const router = useRouter();
// in the create/empty state, before the template option:
<TouchableOpacity
  style={styles.primaryCreate /* reuse the file's primary button style */}
  onPress={() => router.push({ pathname: '/schedule-builder', params: { projectId: selectedProject.id } } as never)}
  testID="mobile-onramp-interview"
  accessibilityRole="button"
  accessibilityLabel="Build schedule by answering a few questions with AI"
>
  <Text style={styles.primaryCreateText}>Answer a few questions</Text>
</TouchableOpacity>
```

Keep the existing template / example / manual options as secondary. If `selectedProject` can be null in this block, guard the button with the same guard the surrounding create options use.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 4: Verify the round-trip on the simulator**

On the iPhone simulator, open a project with no schedule → tap "Answer a few questions" → complete/skip the interview → generation → `schedule-review` → Accept → confirm the schedule appears in the classic mobile schedule and persisted (reload the project). If Accept does not return to the mobile schedule, note the `schedule-review` Accept destination for Task 7.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/schedule/index.tsx"
git commit -m "schedule(mobile): AI Schedule Builder entry in the create flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4 (Part B): Copilot edit bar on the mobile schedule

**Files:**
- Modify: `app/(tabs)/schedule/index.tsx`

- [ ] **Step 1: Add edit-panel state + the mobile commit**

Reuse the existing `ScheduleEditPanel` (it is surface-agnostic — it takes a `commit`). Add:

```tsx
import ScheduleEditPanel from '@/components/copilot/ScheduleEditPanel';
import { applyToProjectSchedule } from '@/utils/copilot/scheduleEdit/applyToProjectSchedule';
import type { ScheduleTask } from '@/types';
// ...inside the component:
const [editOpen, setEditOpen] = useState(false);

const cpmOptions = useMemo(() => ({
  scheduleStartDate: activeSchedule?.startDate,
  workingDaysPerWeek: activeSchedule?.workingDaysPerWeek,
  nonWorkingDates: activeSchedule?.nonWorkingDates,
}), [activeSchedule?.startDate, activeSchedule?.workingDaysPerWeek, activeSchedule?.nonWorkingDates]);

const mobileCommit = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => {
  if (!selectedProject || !activeSchedule) return;
  const next = producer(sortedTasks);
  const schedule = applyToProjectSchedule(activeSchedule, next, cpmOptions);
  updateProject(selectedProject.id, { schedule: { ...schedule, updatedAt: new Date().toISOString() } });
}, [selectedProject, activeSchedule, sortedTasks, cpmOptions, updateProject]);
```

(Use the file's real names for the current schedule + tasks — from the audit: `activeSchedule`, `sortedTasks`, `selectedProject`, `updateProject`. If `sortedTasks` is a sorted view, pass the source task array the screen persists so ordering is preserved; verify against `handleSaveTask`'s task source.)

- [ ] **Step 2: Add the pinned copilot bar + mount the panel**

Near the schedule's action area (visible while a schedule exists), add a pinned bar and mount the panel:

```tsx
{sortedTasks.length > 0 && (
  <TouchableOpacity
    style={styles.copilotBar /* new style: row, accent border, pill radius via Tokens.radius.full, accent-soft bg */}
    onPress={() => setEditOpen(true)}
    testID="schedule-copilot-bar"
    accessibilityRole="button"
    accessibilityLabel="Tell the copilot what to change"
  >
    <Mic size={16} color={themeColors.accent} />
    <Text style={styles.copilotBarText}>Tell me what to change</Text>
  </TouchableOpacity>
)}

{selectedProject && (
  <ScheduleEditPanel
    visible={editOpen}
    onClose={() => setEditOpen(false)}
    projectId={selectedProject.id}
    tasks={sortedTasks}
    commit={mobileCommit}
    cpmOptions={cpmOptions}
  />
)}
```

`Mic` is already imported in this file (audit noted `Mic` on line 50). Style the bar with `Colors`/`Type`/`Tokens` (e.g. `borderColor: themeColors.accent`, `borderRadius: Tokens.radius.full`) — no raw hex/fontSize/borderRadius literals.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 4: Verify on the simulator**

On the sim, open a project with a schedule → tap the copilot bar → type "push framing back a week" → confirm the reflow preview (`ScheduleDiffView`) shows a finish delta + moved tasks → Apply → confirm the schedule updates and dependents moved, and it persists after reload.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/schedule/index.tsx"
git commit -m "schedule(mobile): pinned copilot edit bar (voice/type -> reflow preview -> apply)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5 (Part C): Streamlined tap-to-edit — surface Starts/Duration/Status with a date picker

**Files:**
- Modify: `app/(tabs)/schedule/index.tsx`

- [ ] **Step 1: Read the task edit modal + Advanced section**

Run: `sed -n '1470,1520p' "app/(tabs)/schedule/index.tsx"`
Expected: the task edit modal with the `Advanced` section that currently hides `startDayOverride` (a raw day number). Note `handleSaveTask` (`~:398`) and the calendar-date→startDay translation (`~:409–426`, `startDayFromDate`).

- [ ] **Step 2: Add a "Starts" field with DatePickerModal in the MAIN modal body**

Move date editing out of Advanced. In the main edit-modal body (alongside Duration and Status), add a "Starts" row that opens `DatePickerModal`. Reuse the file's existing `projectStartDate` anchor + `addWorkingDays` to convert the picked ISO date to a `startDay` offset (the file already does this in `handleSaveTask` at `~:409–426` — factor that conversion into a small local helper `isoToStartDay(iso)` and reuse it here so the date picker and save path agree). Wire:

```tsx
import DatePickerModal from '@/components/DatePickerModal';
// modal state:
const [startPickerOpen, setStartPickerOpen] = useState(false);
// in the main modal body:
<TouchableOpacity style={styles.fieldRow} onPress={() => setStartPickerOpen(true)} testID="task-edit-starts">
  <Text style={styles.fieldLabel}>Starts</Text>
  <Text style={styles.fieldValue}>{startLabelForDraft /* formatted date from draft.startDay via projectStartDate + addWorkingDays */}</Text>
</TouchableOpacity>
<DatePickerModal
  visible={startPickerOpen}
  value={startIsoForDraft /* current draft start as ISO, or '' */}
  allowFuture
  title="When does this task start?"
  onClose={() => setStartPickerOpen(false)}
  onChange={(iso) => { setStartPickerOpen(false); setDraft(d => ({ ...d, startDayOverride: String(isoToStartDay(iso)) })); }}
/>
```

Keep Duration and Status where they are; just ensure all three read as first-class fields in the main body (not behind Advanced). Leave the Advanced `startDayOverride` raw-number input in place for power users, but it is no longer the only way to change a date.

- [ ] **Step 3: On save, reflow + show the ripple when it cascades**

In `handleSaveTask` (or the modal's save handler), after producing the next task array, persist through `applyToProjectSchedule(activeSchedule, nextTasks, cpmOptions)` (so dependents reflow consistently with Part B). Before persisting, compute a diff to decide whether to confirm:

```tsx
import { diffSchedule } from '@/utils/copilot/scheduleEdit/diffSchedule';
import { runCpm } from '@/utils/cpm';
// after building nextTasks in the save handler:
const before = sortedTasks;
const d = diffSchedule(before, nextTasks, runCpm(before, cpmOptions), runCpm(nextTasks, cpmOptions));
const cascades = d.moved.length > 1 || d.finishDeltaDays !== 0 || d.criticalEntered.length > 0;
```

If `cascades`, show a compact confirm (a small modal or the existing confirm pattern in the file) with the one-line summary — finish `d.finishBeforeDay` → `d.finishAfterDay`, `${d.moved.length} tasks move` — and only persist on confirm; otherwise persist immediately. Persist via `updateProject(selectedProject.id, { schedule: { ...applyToProjectSchedule(activeSchedule, nextTasks, cpmOptions), updatedAt: new Date().toISOString() } })`.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 5: Verify on the simulator**

Tap a task → tap "Starts" → pick a date → if it moves dependents, confirm the ripple summary appears → apply → confirm the task and its successors moved and persisted. Then change a leaf task's date (no dependents) → confirm it applies without a ripple prompt.

- [ ] **Step 6: Commit**

```bash
git add "app/(tabs)/schedule/index.tsx"
git commit -m "schedule(mobile): tap-to-edit Starts/Duration/Status with a date picker + ripple confirm

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6 (Part C): Real date picker for the schedule start date

**Files:**
- Modify: `components/schedule/ScheduleSettingsMenu.tsx`

- [ ] **Step 1: Read the current start-date input**

Run: `sed -n '135,160p' components/schedule/ScheduleSettingsMenu.tsx`
Expected: a `TextInput` for `YYYY-MM-DD` (`~:147–157`) with manual validation (`~:57–59`).

- [ ] **Step 2: Replace the TextInput with DatePickerModal**

Add a tappable row that shows the current start date (or "Not set") and opens `DatePickerModal`; on change, call the same `onApply`/patch path the menu already uses for `startDate` (an ISO `YYYY-MM-DD`). Note `DatePickerModal.onChange` returns an ISO string at noon UTC — slice to `YYYY-MM-DD` before storing to match the existing `startDate` format:

```tsx
import DatePickerModal from '@/components/DatePickerModal';
const [pickerOpen, setPickerOpen] = useState(false);
// replace the TextInput row with:
<TouchableOpacity onPress={() => setPickerOpen(true)} testID="schedule-startdate-pick">
  <Text style={/* existing value style */}>{startDate || 'Not set'}</Text>
</TouchableOpacity>
<DatePickerModal
  visible={pickerOpen}
  value={startDate || ''}
  allowFuture
  title="Schedule start date"
  onClose={() => setPickerOpen(false)}
  onChange={(iso) => { setPickerOpen(false); onStartDateChange(iso.slice(0, 10)); }}
/>
```

Use the menu's existing setter/handler for the start date (match the current `onApply`/state name — read `:138–158`). Keep the existing help text.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 4: Verify on the simulator (desktop scheduler)**

In the desktop scheduler settings, open the start-date row → pick a date → confirm it applies and the schedule re-anchors with the reflow shown (the first-time anchor should surface the rebase, not silently jump).

- [ ] **Step 5: Commit**

```bash
git add components/schedule/ScheduleSettingsMenu.tsx
git commit -m "schedule: real date picker for the schedule start date (no typed YYYY-MM-DD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7 (Part B parity): Copilot bar on the desktop scheduler

**Files:**
- Modify: `app/schedule-pro.tsx`

- [ ] **Step 1: Confirm the existing edit entry**

Run: `grep -nE "editOpen|ScheduleEditPanel|Voice|HeaderBtn" app/schedule-pro.tsx | head`
Expected: `ScheduleEditPanel` is already mounted (`~:1773`) with `commit`/`tasks`/`cpmOptions`, and there is a "Voice" `HeaderBtn` that sets `editOpen`.

- [ ] **Step 2: Add the same pinned copilot bar**

For parity with mobile, add a pinned "Tell me what to change" bar above the grid/cockpit that sets `editOpen(true)` (reusing the already-wired `ScheduleEditPanel`). Use `Colors`/`Type`/`Tokens`. This is presentation only — the panel + `commit()` already exist.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/schedule-pro.tsx
git commit -m "schedule(desktop): pinned copilot edit bar for parity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

Run: `bun run ship-check`
Expected: green, including `test:copilot-mobile-apply` (`5 passed`).

- [ ] **Step 2: End-to-end on the simulator**

On the iPhone sim, run the whole loop on a scratch project: create a schedule via **Answer a few questions** → edit it two ways — say "demo starts later" via the copilot bar (reflow preview → apply) and tap a task to change its **Starts** date (ripple confirm → apply) — and confirm both persist after a reload. Change the schedule start date via the new picker and confirm the reflow is shown, not silent.

- [ ] **Step 3: Record the checks**

Note in the completion that ship-check is green and the sim loop passed. Do NOT merge or OTA (owner-gated).

---

## Self-Review

- **Spec coverage:** core reflow-preview pattern → Tasks 1/4/5 ✓; Part A (builder on iOS) → Task 3 ✓; Part B (copilot bar + mobile apply via `applyToProjectSchedule`/`updateProject`) → Tasks 1/4, desktop parity Task 7 ✓; Part C (tap-to-edit + `DatePickerModal` + cascade preview) → Tasks 5/6 ✓; validator wired → Task 2 ✓; OTA-safe/no new edge fn ✓.
- **Placeholder scan:** the one new pure file + its validator have complete code; integration tasks give exact APIs, the reuse component (`ScheduleEditPanel`), the `mobileCommit` code, `DatePickerModal` usage, and `router.push` — with `sed`/`grep` steps to locate the exact insertion points in the two large existing files (the implementer must match surrounding style, which is the correct pattern for editing large RN screens).
- **Type/naming consistency:** `applyToProjectSchedule(schedule, editedTasks, cpmOptions)` signature is identical across Tasks 1/4/5; `cpmOptions` shape identical (`scheduleStartDate`/`workingDaysPerWeek`/`nonWorkingDates`); `CpmTaskResult.es` used for reflow; `ScheduleEditPanel` prop names match `components/copilot/ScheduleEditPanel.tsx`; `DatePickerModal` prop names match `components/DatePickerModal.tsx`.
- **Note for implementer:** confirm the mobile screen's real variable names (`activeSchedule`, `sortedTasks`, `selectedProject`, `updateProject`, `themeColors`) by reading the top of `app/(tabs)/schedule/index.tsx` before wiring — the audit found these, but match the file. If `sortedTasks` is a display-sorted copy, persist from the screen's source task array so order is stable.
