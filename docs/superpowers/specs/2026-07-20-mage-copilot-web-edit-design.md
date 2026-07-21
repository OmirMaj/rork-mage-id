# MAGE Copilot — Schedule Web-Edit (conversational schedule editing)

**Status:** Design approved 2026-07-20. Branch `claude/copilot-web-edit` (off `main` @ 0f48a91).

**Goal:** Let a contractor talk or type an edit to an *existing* schedule — "push framing back a week and re-level the crew, and add a procurement milestone for the cabinets" — see the CPM cascade rendered as a before→after **diff**, then apply it through the **same undo-safe path as a manual edit**.

**Why:** The phone-create half of MAGE Copilot shipped (16 voice capabilities that CREATE records via a grounded clarifying interview). The vision is "phone create on-site, web edit at the desk." This is the first edit surface: the flagship Schedule, edited conversationally on the desktop editor. Estimate editing is a deliberate fast-follow (separate spec) that reuses this pattern with the ready-made `commitEstimatePatch()` + `diffEstimates()`.

---

## 1. Scope & decisions (locked)

- **First (and only) entity this spec covers: Schedule.** Estimate = later sibling spec.
- **Confirm UX: diff-preview-then-apply.** The command is interpreted, CPM re-run, and the ripple shown BEFORE committing. This is the "explains itself" moat — the contractor sees the consequence (finish-date move, which tasks became critical, what was added/moved), not just the raw change.
- **Edit model: a typed edit-operation vocabulary** the AI emits as JSON, interpreted by a **pure** function, never freeform `Partial<ScheduleTask>` patches. Pure → validator-testable, previewable, undo-safe.
- **Reuse the copilot engine** (`useCopilotConversation` turn loop + `CopilotShell` §3.7 styling), with two small extensions (a review-render hook + a commit seam).
- Desk-first (the desktop `ScheduleProScreen`); the panel degrades to the same flow on a narrow screen but is not the phone-create path.

---

## 2. Architecture & data flow

```
utterance ("push framing back a week, re-level the crew")
   │
   ▼  [engine turn loop: useCopilotConversation]
mageAI  → emits EditOp[]  (typed ops, task refs resolved to ids)
   │
   ▼  mergeDraft: accumulate ops into the draft
gaps?  ── ambiguous ──▶ ask ONE clarifier (e.g. "which framing — L1 or L2?")
   │  (grounded in the real tasks)
   ▼  ready
interpretScheduleOps(ops, currentTasks) → { nextTasks, applied[], rejected[] }
   │
   ▼
runCpm(nextTasks)  →  cpmAfter        (existing engine)
   │
   ▼
diffSchedule(before, after, cpmBefore, cpmAfter) → ScheduleDiff
   │
   ▼  REVIEW PHASE renders the diff (renderReview hook)
[Apply it]  ──▶  ctx.commitTasks(producer)   ← the screen's own commit()
   │                     │
   │                     ▼  pushHistory + debounced persist + audit entry
[Discard]            undo/redo just works (same stack as manual edits)
```

**Where it lives:** a `ScheduleEditPanel` embedded in `app/schedule-pro.tsx` (the desktop editor, `≥900px`), opened by an "Edit by voice / chat" affordance. Living inside the editor is the crux: it reads the screen's current `tasks` (grounding) and, on Apply, calls the screen's `commit(producer)` — so AI edits and manual edits share ONE write path (history, persist, audit). No second persistence path, no divergence.

---

## 3. The edit-operation vocabulary

A discriminated union (`utils/copilot/scheduleEdit/editOps.ts`). `TaskRef = string` — a task **id**; the AI is given `{id,name}` for every task in grounding and emits the id, with a name-match fallback in the resolver.

```ts
export type EditOp =
  | { op: 'move'; task: TaskRef; deltaDays?: number; toStartDay?: number }
  | { op: 'setDuration'; task: TaskRef; days: number }
  | { op: 'addDependency'; from: TaskRef; to: TaskRef; type: DependencyType; lag?: number }
  | { op: 'removeDependency'; from: TaskRef; to: TaskRef }
  | { op: 'addTask'; title: string; durationDays: number; after?: TaskRef; crew?: number; isMilestone?: boolean }
  | { op: 'removeTask'; task: TaskRef }
  | { op: 'setCrew'; task: TaskRef; crew: number }
  | { op: 'setProgress'; task: TaskRef; pct: number }
  | { op: 'level' }                 // run the existing fix-overloads leveling (cpm.ts level:true)
  | { op: 'setStartDate'; iso: string };
```
`DependencyType = 'FS' | 'SS' | 'FF' | 'SF'` (already in the domain types; `cpm.ts` supports all four + lag).

**Normalizer** `normalizeEditOps(raw: unknown): EditOp[]` — pure; drops malformed ops, clamps obvious bounds (duration ≥ 0, progress 0-100), coerces types. Mirrors `normalizeSplitActions` in `intentTable.ts`.

---

## 4. The pure core (validator-tested)

New file `utils/copilot/scheduleEdit/interpretOps.ts`:

```ts
export interface OpResult { op: EditOp; ok: boolean; reason?: string }
export function interpretScheduleOps(
  ops: EditOp[],
  tasks: ScheduleTask[],
): { nextTasks: ScheduleTask[]; results: OpResult[] };
```
- Applies each op immutably in order against a working copy.
- **Ref resolution:** a `TaskRef` id must exist; if the AI emitted a name, match case-insensitively; unresolved → op rejected with `reason: "no task named '…'"`.
- **Guards:** `addDependency` runs `wouldCreateCycle()` (from `cpm.ts`) → reject on cycle; `setDuration`/`setProgress` bounds; `removeTask` also strips dangling deps that referenced it.
- **Partial application:** valid ops apply; rejected ops are collected in `results` and reported — never silently dropped.
- Uses existing helpers where they exist: `addTask` places after a ref via the same shape `handleCommitAddTask` builds; leveling defers to `runCpm(tasks, { level: true })`'s `leveledStartDays`.

New file `utils/copilot/scheduleEdit/diffSchedule.ts`:

```ts
export interface ScheduleDiff {
  finishBeforeDay: number; finishAfterDay: number; finishDeltaDays: number;
  moved:   { id: string; name: string; startDelta: number; durationDelta: number }[];
  added:   { name: string; startDay: number; durationDays: number; isMilestone: boolean }[];
  removed: { name: string }[];
  depChanges: { from: string; to: string; type: DependencyType; added: boolean }[];
  criticalEntered: string[];   // task names that BECAME critical
  criticalLeft:    string[];   // task names that LEFT the critical path
  overloadDelta?:  number;     // crew-overload count change, when computable
  rejected: { summary: string }[];  // human strings from OpResult failures
}
export function diffSchedule(
  before: ScheduleTask[], after: ScheduleTask[],
  cpmBefore: CpmResult, cpmAfter: CpmResult,
): ScheduleDiff;
```
Pure. Finish days come from `CpmResult.projectFinish`; critical transitions from each result's `perTask[id].isCritical`.

---

## 5. Grounding

`buildScheduleEditGrounding(ctx)` serializes the **current** schedule for the model (this replaces history-grounding — the live schedule IS the grounding):
- `facts`: project name; finish date; count of tasks; today's day-number; whether a start date is set.
- `data`: `{ tasks: {id, name, startDay, durationDays, deps, crew, isCritical}[], projectStartDate, finishDay, calendar }`.

`buildTurnPrompt` embeds the task list (id + name + start/duration + critical flag) and the op schema, and instructs the model to reference tasks by id, emit ONLY ops the contractor actually asked for, and leave a field null to ASK rather than guess (same discipline as the create capabilities).

---

## 6. Engine reuse + the two seams

**New capability** `scheduleEdit` (`utils/copilot/scheduleEdit/scheduleEditCapability.ts`), `aiFeature: 'scheduleCopilot'`:
- `buildGrounding` = `buildScheduleEditGrounding`
- `Draft = { ops: EditOp[] }`
- `mergeDraft(draft, aiJson, meta)` = append `normalizeEditOps(aiJson.ops)` (accumulate across turns; a follow-up answer adds/edits ops)
- `gaps(draft, grounding)` = edit clarifiers (see §7)
- `apply` = interpret + persist via the commit seam

**Seam A — review render hook.** Add optional
`renderReview?(a: { draft: Draft; ctx: CopilotContext; confirm: () => void; cancel: () => void }): ReactNode`
to `CopilotCapability` (`utils/copilot/types.ts`). When a capability provides it, `CopilotShell`'s `review` phase renders it INSTEAD of the generic `copy.reviewHeadline`/`reviewSub` + "Build it" button, and passes the shell's own `confirm`/`cancel`. So the **diff view is drawn by the capability** (it is the only place that knows how to render a schedule diff), and its "Apply it" button calls the passed `confirm()` (→ the normal `apply` → `applying` → `done` path) and its "Discard" calls `cancel()`. The diff itself is computed PURELY inside `renderReview` from `draft.ops` + `ctx.currentTasks` via `interpretScheduleOps` → `runCpm` → `diffSchedule` (cheap; no state). Capabilities without the hook are completely unchanged.

**Seam B — commit injection.** Extend `CopilotContext` with optional `commitTasks?: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => void` and `currentTasks?: ScheduleTask[]` (same additive pattern used for `ctx.safety`). `scheduleEditCapability.apply` re-runs `interpretScheduleOps(draft.ops, ctx.currentTasks)` (pure, matches what the preview showed) and calls `ctx.commitTasks(prev => nextTasks)` → the edit flows through `schedule-pro`'s existing `pushHistory` + debounced persist + audit. Undo/redo is the same stack as manual edits. `apply` returns a no-op `Applied` (the panel closes; no route change — the edit is already reflected in the live editor).

**Panel host** `components/copilot/ScheduleEditPanel.tsx` — a thin host that renders `<CopilotShell capabilityId="scheduleEdit" ctx={{ ...base, commitTasks, currentTasks }} onDone={closePanel} />` inside `ScheduleProScreen`, behind an "Edit by voice / chat" control. All the interview/diff/apply logic lives in the capability + shell; the panel only supplies the ctx seam and placement.

---

## 7. Gaps — edit clarifiers

Fired only when the command is genuinely ambiguous, grounded in the real tasks:
- **Ambiguous ref** ("push framing back" but two framing tasks): `choice` gap listing the matching tasks (L1 Framing / L2 Framing).
- **Leveling cap** ("re-level the crew"): `number` gap "cap the crew at how many?" (uses the new numeric input from the hardening pass), default from history.
- **Missing referent** ("add a milestone for the cabinets" but no cabinet task): `choice` — "the cabinets aren't on the schedule — add a 2-week procurement milestone before which task?" or skip.

Gaps use the same `impact`/`askThreshold` discipline; below-threshold ambiguities resolve to the grounded default (shown, not asked).

---

## 8. Errors

- **Rejected ops** (unresolved ref, cycle, out-of-bounds) appear in the diff's `rejected[]` and are NOT applied; valid ops still apply. The review makes this explicit ("Couldn't find a 'framing' task — skipped").
- **Empty result** (every op rejected, or the model emitted none): the panel stays in review with a "nothing to change — try rephrasing" state; nothing is committed.
- **AI relay failure**: same `error` phase as the create flow (`useCopilotConversation` already handles `APPLY_ERR`).
- **No schedule / no tasks**: the panel entry is gated on a non-empty schedule (the desktop editor only shows for a project with a schedule anyway).

---

## 9. Testing (pure-fn validators, wired into ship-check)

Following the established no-jest, `scripts/validate-*.ts` pattern (pure files only — no `mageAI`/RN imports):
- `validate-copilot-edit-ops.ts` — `normalizeEditOps` (drops malformed, clamps bounds, coerces) + `interpretScheduleOps` (each op applies; ref resolution by id + name; cycle guard rejects; bounds; removeTask strips dangling deps; partial application).
- `validate-copilot-diff-schedule.ts` — `diffSchedule` (finish delta; moved/added/removed; critical entered/left; rejected passthrough) on hand-built before/after task arrays + `runCpm` results.

`interpretOps.ts`/`diffSchedule.ts`/`editOps.ts` import only domain types + `cpm.ts` (RN-free) so the validators can drive them directly.

---

## 10. File structure

**New:**
- `utils/copilot/scheduleEdit/editOps.ts` — `EditOp` union + `normalizeEditOps` (pure)
- `utils/copilot/scheduleEdit/interpretOps.ts` — `interpretScheduleOps` (pure)
- `utils/copilot/scheduleEdit/diffSchedule.ts` — `diffSchedule` + `ScheduleDiff` (pure)
- `utils/copilot/scheduleEdit/scheduleEditGrounding.ts`
- `utils/copilot/scheduleEdit/scheduleEditCapability.ts` — the capability; its `renderReview` mounts `ScheduleDiffView` via `React.createElement` (no JSX in this `.ts`, so the pure sibling files stay validator-safe)
- `components/copilot/ScheduleDiffView.tsx` — computes the diff (`interpretScheduleOps` → `runCpm` → `diffSchedule`, memoized) and renders it with "Apply it" / "Discard" wired to the passed `confirm`/`cancel`
- `components/copilot/ScheduleEditPanel.tsx` — thin in-editor host that mounts `CopilotShell` with the `commitTasks`/`currentTasks` ctx seam
- `scripts/validate-copilot-edit-ops.ts`, `scripts/validate-copilot-diff-schedule.ts`

**Purity boundary:** `editOps.ts`, `interpretOps.ts`, `diffSchedule.ts` import ONLY domain types + `cpm.ts` (RN/React-free) so the validators can drive them. The capability, `ScheduleDiffView`, and the panel may import React/RN freely — the validators never touch them.

**Modified:**
- `utils/copilot/types.ts` — add `renderReview?` to `CopilotCapability`; add `commitTasks?`/`currentTasks?` to `CopilotContext`; add `scheduleEdit` to `CopilotCapabilityId`
- `utils/copilot/registry.ts` — register `scheduleEdit`
- `components/copilot/CopilotShell.tsx` — honor `renderReview` in the review phase
- `app/schedule-pro.tsx` — mount `ScheduleEditPanel`; pass `commit` + `tasks`; add the "Edit by voice / chat" entry
- `package.json` — wire the two new validators into the ship-check chain

**Reused as-is:** `utils/cpm.ts` (`runCpm`, `wouldCreateCycle`), `utils/scheduleHistory.ts`, `hooks/useCopilotConversation.ts`, `utils/mageAI.ts`, the `commit()`/`handleEdit()`/audit path in `schedule-pro.tsx`.

---

## 11. Out of scope (explicitly deferred)

- **Estimate conversational edit** — sibling spec; reuses `commitEstimatePatch()` + `diffEstimates()`; no CPM cascade so much smaller once this ships.
- Editing other entities (daily reports, change orders, etc.) by voice.
- Multi-turn "conversation about the schedule" beyond a single edit → preview → apply (each apply is one grounded edit; chaining is just repeated edits).
- Deploying/OTA — owner-gated as always.
