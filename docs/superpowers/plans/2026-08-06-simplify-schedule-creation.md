# Simplify Schedule Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make creating a schedule feel simple — one recommended way in everywhere, add-a-task = name+duration, and dependencies picked (never typed).

**Architecture:** Three parts. (1) `ScheduleOnRamp` becomes the single recommended, context-aware front door mounted on the Schedule tab, Discover, and Pro; a pure `recommendedOnRampPath()` helper picks the hero action. (2) The wizard task row defers phase/deps/lag behind a per-task "Refine". (3) The wizard's predecessor picker is extracted to a shared component and mounted in the Pro grid, replacing typed `T5FS+3` syntax. Because these touch very large files (`schedule/index.tsx` ~2600, `schedule-wizard.tsx` ~2871, `schedule-pro.tsx`, `GridPane.tsx`), each task begins by READING the current source at the cited anchors and implements a behavior-preserving change; the plan gives target interfaces, exact anchors, and acceptance criteria.

**Tech Stack:** React Native + Expo, TS strict, `bun`. No jest — pure logic validated by a permanent `scripts/validate-*.ts` wired into `ship-check`. UI verified by `tsc` + `bun run lint` + reading; simulator drive where available.

**Reference spec:** `docs/superpowers/specs/2026-08-06-simplify-schedule-creation-design.md`
**Reference audits:** the two schedule-creation audits (normal + Pro) — cited file:lines below.

---

## File structure

- **Create** `utils/scheduleOnRamp.ts` — pure `recommendedOnRampPath(ctx)` + the `OnRampPath` union.
- **Create** `scripts/validate-schedule-onramp.ts` — permanent validator, wired into ship-check.
- **Create** `components/schedule/PredecessorPicker.tsx` — extracted shared multi-predecessor picker (from the wizard's PredecessorSheet).
- **Modify** `components/schedule/ScheduleOnRamp.tsx` — single recommended action + "More ways" disclosure, driven by the helper.
- **Modify** `app/(tabs)/schedule/index.tsx` (empty state ~2511-2593) — mount `ScheduleOnRamp`; delete the 7-button block + the redundant free-form AI entry.
- **Modify** `app/(tabs)/discover/schedule.tsx` (~345-395) — mount the shared `ScheduleOnRamp`.
- **Modify** `app/schedule-wizard.tsx` — blank=blank (~275-284); TasksStep row declutter + earlier start date; consume shared `PredecessorPicker`.
- **Modify** `utils/autoScheduleFromEstimate.ts` + `app/(tabs)/schedule/index.tsx:996` — route Build-from-Estimate through the AI-refined generator; retire `qty/50` default.
- **Modify** `components/schedule/GridPane.tsx` (~90, ~723-760) — Predecessors cell becomes read-only summary that opens `PredecessorPicker`.
- **Modify** `package.json` — wire the new validator into ship-check.

---

## Part 1 — One front door

### Task 1: Pure `recommendedOnRampPath` helper + validator

**Files:** Create `utils/scheduleOnRamp.ts`, `scripts/validate-schedule-onramp.ts`; Modify `package.json`.

- [ ] **Step 1: Write the failing validator** — `scripts/validate-schedule-onramp.ts`:

```ts
import { recommendedOnRampPath } from '@/utils/scheduleOnRamp';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, `\n      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
console.log('\nschedule on-ramp recommended path:');
// Has an estimate → build from it (the moat-linked one-tap path).
eq('estimate wins', recommendedOnRampPath({ hasEstimate: true }), 'estimate');
// No estimate → the scaffolded AI interview.
eq('no estimate → interview', recommendedOnRampPath({ hasEstimate: false }), 'interview');
// Undefined context is safe → interview (never dead-ends).
eq('empty ctx → interview', recommendedOnRampPath({}), 'interview');
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
```

- [ ] **Step 2: Run it** — `bun scripts/validate-schedule-onramp.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `utils/scheduleOnRamp.ts`:**

```ts
/** The ways a user can start a schedule. `estimate`/`interview` are the two
 *  RECOMMENDED heroes; the rest live under "More ways". */
export type OnRampPath =
  | 'estimate' | 'interview' | 'blank' | 'template' | 'voice' | 'example' | 'manual';

export interface OnRampContext {
  /** The active project already has a linkedEstimate to build from. */
  hasEstimate?: boolean;
}

/** Pick the single recommended hero action. Estimate-first (moat-linked, one
 *  tap); otherwise the scaffolded AI interview. Never returns a path that can
 *  dead-end for a fresh user. */
export function recommendedOnRampPath(ctx: OnRampContext): OnRampPath {
  return ctx.hasEstimate ? 'estimate' : 'interview';
}
```

- [ ] **Step 4: Run it** — `bun scripts/validate-schedule-onramp.ts` → `3 passed, 0 failed`.

- [ ] **Step 5: Wire into ship-check** — in `package.json` add `"test:schedule-onramp": "bun run scripts/validate-schedule-onramp.ts",` and append ` && bun run test:schedule-onramp` to the END of the `ship-check` chain.

- [ ] **Step 6:** `npx tsc --noEmit` (zero errors) → commit:
```bash
git add utils/scheduleOnRamp.ts scripts/validate-schedule-onramp.ts package.json
git commit -m "feat(schedule): recommended on-ramp path helper + validator"
```

### Task 2: Redesign `ScheduleOnRamp` to one recommended action + disclosure

**Files:** Modify `components/schedule/ScheduleOnRamp.tsx` (currently the 5-path on-ramp used by `app/schedule-pro.tsx:1655-1676`).

READ the current `ScheduleOnRamp.tsx` first. Target contract:

- [ ] **Step 1: Define the props** so all three mount points can drive it:

```ts
export interface ScheduleOnRampProps {
  hasEstimate: boolean;
  canBuildByVoice?: boolean;     // gate the voice path (needs estimate/eligibility)
  onPick: (path: OnRampPath) => void;   // one callback; host routes per path
}
```

- [ ] **Step 2: Render one recommended hero + secondary + disclosure.** Compute `const hero = recommendedOnRampPath({ hasEstimate })` (import from `@/utils/scheduleOnRamp`). Layout:
  - Primary hero card = `hero` (`estimate` → "Build from your estimate", copy "One tap — MAGE drafts the tasks from your estimate, you adjust."; `interview` → "Answer a few quick questions", copy "MAGE asks the smart questions, then builds it.").
  - Always-visible secondary = **Start blank** ("Creates an empty schedule on this project — add tasks inside it.").
  - A **"More ways ▾"** toggle (local `useState` disclosure) revealing: Start from a template, Build by voice (only if `canBuildByVoice`), Load an example, Add tasks manually.
  - Every tap calls `onPick(path)`. No path is presented with equal weight to the hero. Use design tokens (no raw hex/fontSize); reuse the file's existing card styles.

- [ ] **Step 3:** `npx tsc --noEmit` (zero errors). Because `schedule-pro.tsx` already renders `ScheduleOnRamp`, update its usage to the new props (pass `hasEstimate`, `canBuildByVoice`, and an `onPick` that maps each path to Pro's existing route/handler — the same destinations the old 5 paths used). Verify Pro still compiles.

- [ ] **Step 4: Commit:**
```bash
git add components/schedule/ScheduleOnRamp.tsx app/schedule-pro.tsx
git commit -m "feat(schedule): ScheduleOnRamp = one recommended path + more-ways disclosure"
```

### Task 3: Mount `ScheduleOnRamp` on the Schedule tab empty state

**Files:** Modify `app/(tabs)/schedule/index.tsx` (empty state ~2511-2593).

- [ ] **Step 1:** READ the current empty-state block (the 7 `TouchableOpacity` buttons). Replace the whole block with `<ScheduleOnRamp hasEstimate={hasEstimate} canBuildByVoice={!!selectedProject?.linkedEstimate} onPick={handleOnRampPick} />`.

- [ ] **Step 2: Implement `handleOnRampPick(path)`** mapping each `OnRampPath` to the EXISTING handler/route already in this file:
  - `estimate` → `handleBuildFromEstimate()` (see Task 5 — now AI-refined)
  - `interview` → `router.push('/schedule-builder', { projectId })`
  - `blank` → `router.push('/schedule-wizard?scratch=1', { projectId })`
  - `template` → open the existing template picker (`setIsTemplatePickerOpen(true)`)
  - `voice` → `router.push('/copilot', { capabilityId: 'schedule', projectId })`
  - `example` → the existing load-demo handler
  - `manual` → the existing quick-add handler
  Delete the now-unused bespoke buttons AND the redundant free-form "Generate with AI" entry (`setIsAIBuilderOpen`) from the empty state (leave the underlying modal component if referenced elsewhere; just stop surfacing it here).

- [ ] **Step 3:** `npx tsc --noEmit` (zero errors). Manual: on a project with no schedule, the tab shows ONE recommended action + Start blank + "More ways ▾" — not 7 equal buttons.

- [ ] **Step 4: Commit:**
```bash
git add "app/(tabs)/schedule/index.tsx"
git commit -m "feat(schedule): Schedule tab uses the shared one-path on-ramp"
```

### Task 4: Mount the shared `ScheduleOnRamp` on the Discover schedule screen

**Files:** Modify `app/(tabs)/discover/schedule.tsx` (~345-395).

- [ ] **Step 1:** READ the current hero+OR+AI+template layout. Replace it with `<ScheduleOnRamp hasEstimate={...} canBuildByVoice={...} onPick={handleOnRampPick} />`, mapping paths to this screen's existing handlers (`handleStartFromScratch` → `blank`, its AI-generate → `interview`, its template list → `template`, etc.). Keep the "Existing schedules" list below unchanged.

- [ ] **Step 2:** `npx tsc --noEmit` (zero errors). Manual: Discover schedule now renders the identical front door as the tab.

- [ ] **Step 3: Commit:**
```bash
git add "app/(tabs)/discover/schedule.tsx"
git commit -m "feat(schedule): Discover schedule uses the shared on-ramp (consistent front door)"
```

### Task 5: Build-from-Estimate goes through the AI-refined generator

**Files:** Modify `app/(tabs)/schedule/index.tsx` (`handleBuildFromEstimate` ~960-1050, the `qty/50` at ~996) and `utils/autoScheduleFromEstimate.ts`.

- [ ] **Step 1:** READ `handleBuildFromEstimate` and `utils/autoScheduleFromEstimate.ts`. Change the default path so "Build from your estimate" calls the **AI-refined** generator (`generateScheduleFromEstimate` / the AI branch in `autoScheduleFromEstimate.ts`), NOT the `const duration = Math.max(1, Math.round(totalQty / 50))` heuristic. Keep the heuristic only as an offline fallback if the AI call fails (so it never dead-ends), clearly the fallback, not the default.

- [ ] **Step 2:** `npx tsc --noEmit` (zero errors). Manual: with an estimate, "Build from your estimate" produces AI-sequenced tasks/durations (lands on `/schedule-review`), not `qty/50` durations.

- [ ] **Step 3: Commit:**
```bash
git add "app/(tabs)/schedule/index.tsx" utils/autoScheduleFromEstimate.ts
git commit -m "fix(schedule): build-from-estimate uses the AI generator, heuristic is fallback only"
```

### Task 6: Blank means blank

**Files:** Modify `app/schedule-wizard.tsx` (~275-284, the `seedTemplateId` memo).

- [ ] **Step 1:** READ the `seedTemplateId`/seed logic. When `startScratch` (route `scratch=1`) is true, seed **zero** template tasks (open with a single empty row, as the "blank canvas" path — the audit shows it currently falls back to `'kitchen-remodel'` when no template param). Ensure the Tasks step opens empty on the blank path; the template path (explicit `template=<id>`) is unaffected.

- [ ] **Step 2:** `npx tsc --noEmit` (zero errors) and `bun run test:schedule-wizard-ux` (must stay green). Manual: "Start blank" opens an empty task list, not Kitchen tasks.

- [ ] **Step 3: Commit:**
```bash
git add app/schedule-wizard.tsx
git commit -m "fix(schedule): blank path seeds no template tasks"
```

---

## Part 2 — Defer the wizard's per-task power mechanics

### Task 7: Wizard — declutter the row, inline the date, one page on desktop

**Files:** Modify `app/schedule-wizard.tsx` (STEPS ~61, TasksStep ~691, task row ~1400-1650, PhasePickerSheet/PredecessorSheet call sites, timeline/date ~2015-2070). Uses `utils/useResponsiveLayout.ts` (`isDesktop`).

- [ ] **Step 1 (all screens — declutter the row):** READ the TasksStep task-row render. Change the default row to show only **Name + Duration**. Move the Phase chip and the Predecessors/sequence chip behind a per-row **"Refine ▾"** disclosure (local per-row expanded state) that reveals phase + dependencies (+ lag) using the EXISTING PhasePickerSheet and the `PredecessorPicker` from Task 8. Nothing under Refine is required to add a task or advance.

- [ ] **Step 2 (all screens — inline the date):** Put the **start day + time** control directly in the Tasks step (the existing DatePickerModal / date control), so the user sets it while adding tasks — never paging forward to Step 3 to reach the CPM anchor. Keep the working-days explainer copy.

- [ ] **Step 3 (WIDE screens — one page, the founder's steer):** Gate on `useResponsiveLayout().isDesktop`. At desktop width, render the wizard as a **single two-pane page** instead of the stepped flow: **left pane** = the task list (name / duration / Refine) + the inline start day+time picker; **right pane** = the live timeline/Gantt preview (reuse the existing `ScheduleStep`/preview render) that updates as tasks and dates change. Compose the EXISTING step components onto one page — do NOT fork the wizard logic (same draft state, CPM `runCpm`, autosave, validators). **On phones, keep the existing 4-step flow unchanged** (Project → Tasks → Timeline → Review). Use the horizontal space: two columns, the timeline always visible beside the task list. Use design tokens; no raw hex/fontSize.

- [ ] **Step 4:** `npx tsc --noEmit` (zero errors) and `bun run test:schedule-wizard-ux` green (the dependency-sentence wording contract must hold). Manual — phone: 4-step flow unchanged, adding a task needs only name+duration, date reachable in the Tasks step. Desktop (width ≥ the hook's breakpoint): one page shows tasks + inline date + live timeline together; no page-forward to set the date.

- [ ] **Step 5: Commit:**
```bash
git add app/schedule-wizard.tsx
git commit -m "feat(schedule): wizard row = name+duration; inline date; one-page two-pane on desktop"
```

---

## Part 3 — Pickable dependencies in Pro

### Task 8: Extract the wizard's predecessor picker into a shared component

**Files:** Create `components/schedule/PredecessorPicker.tsx`; Modify `app/schedule-wizard.tsx` (PredecessorSheet ~1650-1800).

- [ ] **Step 1:** READ the wizard's PredecessorSheet (multi-select earlier tasks + per-link type FS/SS/FF/SF + lag stepper + cycle/self guards). Extract it VERBATIM (behavior-preserving) into `components/schedule/PredecessorPicker.tsx` with an explicit interface:

```ts
export interface PredecessorLink { taskId: string; type: 'FS'|'SS'|'FF'|'SF'; lagDays: number }
export interface PredecessorPickerProps {
  /** Tasks that may be selected as predecessors (already ordered/eligible). */
  candidates: { id: string; label: string }[];
  value: PredecessorLink[];
  onChange: (links: PredecessorLink[]) => void;
  onClose: () => void;
}
```
Keep the exact guards and lag UI. The wizard now renders `<PredecessorPicker .../>` instead of its inline sheet, mapping its task shape to `candidates`.

- [ ] **Step 2:** `npx tsc --noEmit` (zero errors) and `bun run test:schedule-wizard-ux` green — the extraction must NOT change the wizard's dependency wording/behavior (this is the guarded contract).

- [ ] **Step 3: Commit:**
```bash
git add components/schedule/PredecessorPicker.tsx app/schedule-wizard.tsx
git commit -m "refactor(schedule): extract shared PredecessorPicker from the wizard (behavior-preserving)"
```

### Task 9: Pro grid Predecessors cell = tap-to-pick (no typed syntax)

**Files:** Modify `components/schedule/GridPane.tsx` (Predecessors column ~90, inline text edit ~723-760).

- [ ] **Step 1:** READ the Predecessors column + inline edit. Change the cell to render a **read-only human summary** of the task's predecessor links (e.g. "Framing FS+3, Rough-in SS") and, on tap, open `<PredecessorPicker>` (Task 8) seeded with the project's eligible earlier tasks as `candidates` and the task's current links as `value`. On `onChange`, write the same `dependencyLinks` patch the drag-to-link already produces (`{taskId, type, lagDays}`) and re-run CPM via the existing commit path. Lag is edited in the picker's stepper — no delete-and-retype.

- [ ] **Step 2:** Remove the typed-syntax requirement as the primary path. If a raw "type instead" affordance is trivial to keep for power users, keep it secondary; otherwise drop it. Keep the Gantt drag-to-link untouched.

- [ ] **Step 3:** `npx tsc --noEmit` (zero errors). Manual (sim/desktop width ≥900): in Pro, tapping a Predecessors cell opens the picker; selecting a task + type + lag updates the grid summary and ripples CPM; changing a lag is a stepper, not a retype.

- [ ] **Step 4: Commit:**
```bash
git add components/schedule/GridPane.tsx
git commit -m "feat(schedule): Pro predecessors are picked, not typed (T5FS+3 retired)"
```

---

## Final Task 10: Ship-check + review

- [ ] **Step 1:** `bun run ship-check` → green (incl. `test:schedule-onramp` and `test:schedule-wizard-ux`). Fix anything flagged.
- [ ] **Step 2:** Grep sanity: `grep -rn "ScheduleOnRamp\|recommendedOnRampPath\|PredecessorPicker" app components utils` — the shared components are mounted at the three front doors + the grid, and the helper drives the hero.
- [ ] **Step 3: Commit** any fixes: `git add -A && git commit -m "chore(schedule): ship-check green"`.

---

## Self-review — spec coverage

- One recommended, context-aware front door (tab + Discover + Pro) → Tasks 1-4. ✓
- Kill redundant free-form AI entry → Task 3. ✓
- Build-from-estimate via AI generator, retire qty/50 default → Task 5. ✓
- Blank = blank → Task 6. ✓
- Wizard add-task = name+duration; phase/deps/lag behind Refine; earlier start date → Task 7. ✓
- Extract shared predecessor picker; Pro deps picked not typed → Tasks 8-9. ✓
- Non-goals (no CPM change, no anchors/resource-calendar UX, no Gantt redesign) → not tasked. ✓
- Ship discipline (validator wired, ship-check, wizard-ux contract kept green) → Tasks 1,6,7,8,10. ✓

Names are consistent across tasks: `OnRampPath`, `recommendedOnRampPath`, `ScheduleOnRampProps.onPick`, `PredecessorLink {taskId,type,lagDays}`, `PredecessorPickerProps`. Large-file tasks each start by reading the cited anchor before editing (target interfaces + acceptance criteria given in lieu of fabricated line-exact code for 2000+ line files).
