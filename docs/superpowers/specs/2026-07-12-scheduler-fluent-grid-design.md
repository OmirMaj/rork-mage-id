# Scheduler Phase 2 — Fluent Grid — Design

**Date:** 2026-07-12
**Branch:** `claude/scheduler-front-door` (continues the scheduler ease-redesign round; PR #74)
**Surface:** Web / desktop Pro scheduler only (`app/schedule-pro.tsx`, `components/schedule/GridPane.tsx`). Phone stays on tap-to-add — a separate track.
**Status:** Approved design → implementation plan next.

## Goal

Let a user author a schedule like a spreadsheet — type down a list of tasks, paste from Excel, insert a row anywhere — without ever opening the Add Task modal. Phase 1 gave the scheduler a front door and coherent shell; the inc-1/inc-2 rounds gave crisp dependency arrows, a Plan/Track/Share menu bar, and outline authoring. This phase closes the last big MS-Project ease gap: **fluent, keyboard-first task entry.**

## Current state (the friction)

- **Adding a task** = click a button → `handleAddTask` sets `showAddTask` → fill `AddTaskModal` → submit → `handleCommitAddTask` builds one task through the undo-aware `commit()` (append-after-last `startDay`, `generateWbsCodes`). Building a 20-task plan = 20 modal round-trips.
- **Inline editing already exists and is good on web** (`GridPane.tsx`): `beginEdit(row, col)` / `commitEdit()` / `cancelEdit()` / `moveEdit(dir)` with Tab / Shift-Tab / Arrow-Up/Down / Escape wired via `onKeyPress` + `onKeyDown` (dates). But:
  - **Enter just commits in place** (`onSubmitEditing → commitEdit`) — it doesn't advance.
  - There is **no always-ready empty row** — you can only edit tasks that already exist.
  - There is **no paste-to-rows** and **no inline insert**.

Everything below extends the existing `editing` model and the existing `commit()` path. No new state machine, no changes to CPM, the offline queue, or persistence.

## The four behaviors

### 1. Inline ghost row

A permanent synthetic row rendered **after** the last real task in the grid's `ScrollView.map`, showing placeholder `＋ Type a task name…`. It is not a member of `tasks` — so it is excluded from selection, bulk ops, `getHiddenTaskIds`, the context menu, and CPM.

- Focusing its name cell and typing, then **Enter**, calls `onAddTasks([{ title }])` (see Architecture) → the task is appended → the ghost row re-renders empty and re-takes focus, so the user keeps typing tasks in a rapid vertical flow.
- Empty title + Enter (or blur) → **no-op** (never create a blank-title task).

### 2. Enter-to-add-next

Extend the existing keyboard model with one rule: **Enter commits and moves down one row in the same column** (Excel convention). When already on the last real row, Enter lands in the **ghost row's name cell** — so Enter reads as "next task."

- Tab / Shift-Tab / Arrow-Up/Down / Escape are unchanged.
- Implementation: `moveEdit` gains a `'down'` path that, when `editing.row === tasks.length - 1`, targets the ghost row (a sentinel row index `tasks.length`, name column) instead of clamping. Enter routes through `moveEdit('down')` instead of the current commit-in-place.

### 3. Paste-rows (web)

When the **ghost row or a title cell** is focused and the pasted clipboard text **contains a newline**, intercept the web DOM `onPaste` event and create one task per non-empty line, all inside a **single `commit()`** so one Undo removes the entire paste.

- **Smart parse** (`parsePastedRows`, pure): a line containing a tab (copied from Excel/Sheets) maps columns → **Title · Duration · Phase**; a plain line → title-only.
- Single-line paste (no newline) → **do not intercept**; let the browser paste into the cell normally, so ordinary copy-paste of one value still works.
- Cap at `MAX_PASTE_ROWS = 200` parsed rows; document the cap (a schedule pasted 200 tasks at once is already extreme). The cap lives in the pure parser and is covered by a test.

### 4. Insert-anywhere

- Add **Insert above** and **Insert below** to the existing `ScheduleRowMenu` (inc-2 right-click / long-press menu). Each creates one blank task at the anchor's **array position** (above) or position + 1 (below) via `onAddTasks([{ title: '' }], atIndex)`, then immediately begins editing the new row's name cell.
- Keyboard: **`⌘↵` / `Ctrl↵`** while editing a row = insert below that row.
- The insert index is computed from the anchor task's **id → array index** (not the visible row index), so a collapsed-summary filter (`getHiddenTaskIds`) can't misplace the insert.

## Architecture

Three isolated units, each with one responsibility:

### `utils/pasteRows.ts` (new, pure — the one genuinely testable unit)

```ts
export interface ParsedRow { title: string; durationDays?: number; phase?: string }
export const MAX_PASTE_ROWS = 200;
export function parsePastedRows(text: string): ParsedRow[];
```

Behavior:
- Split on `\r\n` or `\n`; trim each line; drop lines whose title is empty after trim.
- Tab-bearing line → split on `\t`: `title` = col 0 (trimmed); `durationDays` = col 1 parsed by `/^(\d+(?:\.\d+)?)/` (strips a trailing `d`/`days`, must be finite and > 0, else omitted); `phase` = col 2 trimmed if non-empty.
- Plain line → `{ title: line }`.
- Truncate to `MAX_PASTE_ROWS`.
- No React, no I/O, no clipboard access — takes a string, returns rows.

### `app/schedule-pro.tsx` — one new callback

```ts
// Bulk-create tasks in a single undo step. atIndex undefined → append;
// atIndex given → splice at that array position. Returns the new ids in order.
const handleAddTasks = useCallback(
  (partials: { title: string; durationDays?: number; phase?: string }[], atIndex?: number): string[] => { ... },
  [commit, ...],
);
```

Implementation, inside one `commit(prev => ...)`:
- For each partial, build a `ScheduleTask`: `id = createId('task')`, `title`, `phase = partial.phase ?? 'General'`, `durationDays = partial.durationDays ?? 1`, `progress: 0`, `crew: ''`, `dependencies: []`, `notes: ''`, `status: 'not_started'`.
- **`startDay`**: sequential append — each new task starts at the max finish (`startDay + durationDays`) of all tasks seen so far (existing + previously-created in this batch), or `1` when empty. A pasted list stacks in order.
- **Insert**: `atIndex === undefined` → append created tasks to the end; else `splice(atIndex, 0, ...created)`.
- Return `generateWbsCodes(next)` from the producer; collect and return the created ids to the caller.
- Wired down to `GridPane` through the existing `SchedulerTabShell → GanttTab → GridPane` prop chain, as an optional prop (the grid still works without it). `InteractiveGantt` does not need it.

### `components/schedule/GridPane.tsx` — the grid wiring

- Render the ghost row after the mapped real rows; its name cell is an editable that commits through `onAddTasks` instead of `onEdit`, then re-focuses itself.
- Extend `moveEdit`'s `'down'` branch to reach the ghost row at the bottom; route Enter through it.
- Add a web `onPaste` handler on the ghost/title inputs: if the clipboard text has a newline, `preventDefault`, `parsePastedRows`, call `onAddTasks(rows)`, and swallow the event.
- Add **Insert above / Insert below** to `rowActions` (the `ScheduleRowMenu` action list) and a `⌘↵`/`Ctrl↵` branch in the title cell's key handler, both calling `onAddTasks([{ title: '' }], insertIndex)` then `beginEdit` on the returned row.
- Focus-after-create: `onAddTasks` returns the new ids; GridPane keeps a `pendingEditRowId` ref and an effect that calls `beginEdit` on that row once it appears (append → re-focus ghost; insert → focus the inserted row).

## Data flow

```
ghost row / paste / insert-menu
        │  onAddTasks(partials, atIndex?)
        ▼
schedule-pro handleAddTasks
        │  commit(prev => generateWbsCodes(splice/append built tasks))
        ▼
undo history + schedulePersist   ── one step, fully undoable
        ▼
tasks re-render → GridPane focuses ghost (append) or new row (insert)
```

## Error handling / edge cases

- Empty ghost title + Enter/blur → no task created.
- Paste with only blank lines → no-op (parser returns `[]`; `handleAddTasks([])` is a no-op that skips `commit`).
- Single-line paste into any cell → browser default (not intercepted).
- Insert index derived from anchor **id**, not visible row index (collapsed-summary safe).
- `handleAddTasks([])` **early-returns `[]` before calling `commit`** — an empty batch never touches history (it can't rely on the `commit` same-reference skip, because `generateWbsCodes` returns a fresh array).
- Ghost row excluded from `selectedIds`, bulk actions, and `getHiddenTaskIds`.

## Testing

- **`scripts/validate-paste-rows.ts`** (pure-fn validator, wired into `ship-check` as `test:paste-rows`): title-only lines; tab-columns → `durationDays` + `phase`; `"5d"` / `"5 days"` duration stripping; empty-line and all-blank skipping; CRLF handling; `MAX_PASTE_ROWS` truncation; non-numeric duration omitted.
- **`npx tsc --noEmit`** clean; **`bun run lint`** 0 errors, no new warnings in touched files.
- **Owner visual review at merge** (Claude can't auth to the web app; desktop Pro renders only above `GRID_BREAKPOINT = 900`): ghost row types down; Enter advances and reaches the ghost; paste of a 5-line list → 5 tasks in one undo; paste from a 3-column spreadsheet maps duration/phase; Insert above/below and `⌘↵` create + focus a new row; one Undo reverses a whole paste.

## Constraints

- **OTA-safe:** JS-only, **no new native modules**. Paste uses the web DOM `onPaste` event, not a native clipboard module.
- CPM (`utils/cpm.ts`), the offline queue, and persistence are untouched — all writes go through the existing `commit()` / `schedulePersist` path.
- Anti-slop lint respected (no inline `fontSize`/`borderRadius`/hex literals in styles — `Colors`/`Type`/`Tokens`).
- Types stay in `types/index.ts`; no `ScheduleTask` shape change (all fields already exist).

## Out of scope (deferred)

- **True drag-to-reorder rows** — needs a native gesture lib (breaks OTA); a future native build. **Move up/down** (inc-2 context menu) already covers reordering.
- **Native / phone paste-to-rows** — no reliable multiline-paste gesture; phone keeps tap-to-add.
- Column reordering / hide-show, fill-down, multi-cell range paste — later polish if wanted.
