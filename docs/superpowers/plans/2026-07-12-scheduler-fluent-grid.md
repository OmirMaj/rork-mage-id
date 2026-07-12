# Scheduler Phase 2 — Fluent Grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author a schedule like a spreadsheet — type down a list in an always-ready ghost row, Enter to advance to the next task, paste rows from Excel, and insert a task anywhere — without opening the Add Task modal.

**Architecture:** One pure parser (`utils/pasteRows.ts`) turns clipboard text into task partials. One new undo-aware bulk-create callback (`handleAddTasks` in `app/schedule-pro.tsx`) builds N tasks in a single `commit()`, threaded down through the existing `SchedulerTabShell → GanttTab → GridPane` prop chain. `GridPane.tsx` grows a ghost row, an Enter-to-next tweak on the name cell, a web `onPaste` handler, and two `ScheduleRowMenu` insert actions. No new state machine, no CPM / offline-queue / persistence changes.

**Tech Stack:** React Native / Expo (New Arch, web+iOS), TypeScript strict, `bun`. `useThemedStyles` + `Colors`/`Type`/`Tokens` (anti-slop lint bans inline `fontSize`/`borderRadius`/hex-in-style literals). No jest — pure fns validated by `scripts/validate-*.ts` wired into the `ship-check` `&&`-chain. **OTA-safe: JS-only, `expo.version` stays 1.0.0, no native modules** (paste uses the web DOM `onPaste` event, not a native clipboard module). Web/desktop only — the desktop Pro grid renders above `GRID_BREAKPOINT = 900`; owner verifies visuals at merge (Claude can't auth to the web app).

**Branch:** `claude/scheduler-front-door` (continues the scheduler round; PR #74).

---

## File Structure

**New**
- `utils/pasteRows.ts` — pure `parsePastedRows(text) → ParsedRow[]`. No React, no I/O, no clipboard access. One responsibility: parse pasted text into task partials.
- `scripts/validate-paste-rows.ts` — pure-fn validator for the above.

**Modified**
- `app/schedule-pro.tsx` — add `handleAddTasks(partials, atIndex?) => string[]` (bulk-create in one `commit()`); pass it to `<SchedulerTabShell onAddTasks=…>`.
- `components/schedule/SchedulerTabShell.tsx` — add `onAddTasks?` to `SchedulerTabShellProps`; thread to `<GanttTab>`.
- `components/schedule/tabs/GanttTab.tsx` — add `onAddTasks?` to `GanttTabProps`; pass to `<GridPane>` (the `split` layout).
- `components/schedule/GridPane.tsx` — add `onAddTasks?` prop; ghost row (replaces the footer "Add task" button); Enter-to-next on the name cell; web `onPaste` on ghost + name inputs; Insert above/below in `rowActions`; `⌘↵`/`Ctrl↵` insert-below on the name cell; focus-after-insert effect.
- `package.json` — add `test:paste-rows` and append it to `ship-check`.

**Task order:** 1 (pure parser) → 2 (bulk-create + threading + ghost row + Enter-to-next) → 3 (paste + insert-anywhere). Sequential — Tasks 2 and 3 both edit `GridPane.tsx` and `app/schedule-pro.tsx`.

---

### Task 1: Pure paste parser + validator

**Files:**
- Create: `utils/pasteRows.ts`
- Create: `scripts/validate-paste-rows.ts`
- Modify: `package.json`

**Context:** No jest in this repo. Pure functions are tested by a standalone `bun` script that asserts and `process.exit(1)` on failure, wired into the `ship-check` `&&`-chain (see the sibling `scripts/validate-outline-ops.ts` for the exact idiom). Tasks are ordered by array position; a `ScheduleTask` needs at minimum `title`; `durationDays` and `phase` are optional here (defaulted at create time in Task 2).

- [ ] **Step 1: Write the failing validator** — `scripts/validate-paste-rows.ts`:

```ts
// scripts/validate-paste-rows.ts — pure-fn validator for utils/pasteRows.ts.
import { parsePastedRows, MAX_PASTE_ROWS } from '../utils/pasteRows';

let pass = 0, fail = 0;
function eq<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}

// Plain lines → title-only, one row per non-empty line.
eq('two plain lines', parsePastedRows('Excavation\nFootings'), [{ title: 'Excavation' }, { title: 'Footings' }]);
// CRLF (Windows / Excel) splits the same as LF.
eq('CRLF split', parsePastedRows('A\r\nB'), [{ title: 'A' }, { title: 'B' }]);
// Blank / whitespace-only lines are dropped.
eq('blank lines skipped', parsePastedRows('A\n\n   \nB'), [{ title: 'A' }, { title: 'B' }]);
eq('all blank → empty', parsePastedRows('\n  \n\t\n'), []);
eq('empty string → empty', parsePastedRows(''), []);
// Tab columns → Title · Duration · Phase.
eq('tab columns map dur+phase', parsePastedRows('Framing\t5\tRough-in'), [{ title: 'Framing', durationDays: 5, phase: 'Rough-in' }]);
// Duration accepts a trailing unit and decimals; must be > 0.
eq('duration "5d" strips unit', parsePastedRows('X\t5d'), [{ title: 'X', durationDays: 5 }]);
eq('duration "2.5 days"', parsePastedRows('X\t2.5 days'), [{ title: 'X', durationDays: 2.5 }]);
eq('non-numeric duration omitted', parsePastedRows('X\tsoon'), [{ title: 'X' }]);
eq('zero duration omitted', parsePastedRows('X\t0'), [{ title: 'X' }]);
// A tab line whose title col is empty is skipped entirely.
eq('empty title col skipped', parsePastedRows('\t5\tPhase'), []);
// Phase only present when non-empty.
eq('empty phase col omitted', parsePastedRows('X\t3\t'), [{ title: 'X', durationDays: 3 }]);
// Truncates to MAX_PASTE_ROWS.
eq('caps at MAX_PASTE_ROWS', parsePastedRows(Array.from({ length: MAX_PASTE_ROWS + 50 }, (_, i) => `T${i}`).join('\n')).length, MAX_PASTE_ROWS);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run to verify it fails** — `bun run scripts/validate-paste-rows.ts` → FAIL (`Cannot find module '../utils/pasteRows'`).

- [ ] **Step 3: Implement `utils/pasteRows.ts`:**

```ts
// utils/pasteRows.ts — pure parser: clipboard text → task partials. No React, no I/O.
// A plain line becomes a title-only task. A tab-bearing line (copied from
// Excel/Sheets) maps columns → Title · Duration · Phase. Consumed by GridPane's
// web onPaste handler, which hands the result to schedule-pro's bulk-create.

export interface ParsedRow {
  title: string;
  durationDays?: number;
  phase?: string;
}

/** Hard cap so a pathological paste can't spawn thousands of rows in one commit. */
export const MAX_PASTE_ROWS = 200;

// Leading number, optionally decimal — ignores a trailing unit like "d" / "days".
const DUR_RE = /^(\d+(?:\.\d+)?)/;

export function parsePastedRows(text: string): ParsedRow[] {
  if (!text) return [];
  const rows: ParsedRow[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    if (rows.length >= MAX_PASTE_ROWS) break;

    if (rawLine.indexOf('\t') >= 0) {
      const cols = rawLine.split('\t');
      const title = (cols[0] ?? '').trim();
      if (!title) continue;
      const row: ParsedRow = { title };
      const durMatch = (cols[1] ?? '').trim().match(DUR_RE);
      if (durMatch) {
        const d = Number.parseFloat(durMatch[1]);
        if (Number.isFinite(d) && d > 0) row.durationDays = d;
      }
      const phase = (cols[2] ?? '').trim();
      if (phase) row.phase = phase;
      rows.push(row);
    } else {
      const title = rawLine.trim();
      if (!title) continue;
      rows.push({ title });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run to verify it passes** — `bun run scripts/validate-paste-rows.ts` → `13 passed, 0 failed`.

- [ ] **Step 5: Wire into `package.json`** — after the `"test:printable-gantt"` line add:

```json
    "test:paste-rows": "bun run scripts/validate-paste-rows.ts",
```

and append ` && bun run test:paste-rows` to the end of the `"ship-check"` value.

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add utils/pasteRows.ts scripts/validate-paste-rows.ts package.json
git commit -m "feat(scheduler): pure parsePastedRows (clipboard → task partials) + validator"
```

---

### Task 2: Bulk-create callback + prop threading + ghost row + Enter-to-next

**Files:**
- Modify: `app/schedule-pro.tsx` (add `handleAddTasks`; pass to `SchedulerTabShell`)
- Modify: `components/schedule/SchedulerTabShell.tsx` (thread prop)
- Modify: `components/schedule/tabs/GanttTab.tsx` (thread prop)
- Modify: `components/schedule/GridPane.tsx` (prop + ghost row + Enter-to-next)

**Context:**
- `commit(producer: (prev: ScheduleTask[]) => ScheduleTask[])` is the undo-aware mutator in `schedule-pro.tsx` (~566). It persists + snapshots history, and already **skips when the producer returns the same array reference**. `createId('task')` and `generateWbsCodes(tasks)` come from `@/utils/scheduleEngine`. The existing `handleCommitAddTask` (~707) shows the canonical new-task shape and the append-`startDay` rule: `startDay = prev.length === 0 ? 1 : Math.max(...prev.map(t => t.startDay + t.durationDays))`.
- `GridPane`'s inline edit model: `editing` is `{ row: number; col: ColumnKey } | null` (`row` is the **array index** into `tasks`); `beginEdit(row, col)`, `commitEdit(): boolean` (guards `if (!editing) return false`), `cancelEdit()`, `moveEdit('next'|'prev'|'down'|'up')`. Rows render via `.map((task, rowIndex) => …).filter(…)` at ~1380 where `rowIndex` is the array index; the footer "Add task" `TouchableOpacity` (~1437) currently calls `onAddTask` (which opens the modal). The name cell is `col.key === 'name'`; its web keys are handled in `renderCell`'s `TextInput` `onKeyPress` (~797).
- `GanttTab` renders `<GridPane>` only in the `split` layout (~178) and passes `onAddTask`/`onDeleteTask`/`onOutline`/`onReorder`.

- [ ] **Step 1: Add `handleAddTasks` in `app/schedule-pro.tsx`** — near `handleCommitAddTask` (after ~770):

```tsx
// Bulk-create tasks in ONE undo step. Used by the grid's ghost row, paste,
// and insert-anywhere. atIndex undefined → append; atIndex given → splice at
// that array position. Returns the new ids in creation order (callers focus
// the first). startDay stacks sequentially so a pasted list lays out in order.
const handleAddTasks = useCallback(
  (partials: { title: string; durationDays?: number; phase?: string }[], atIndex?: number): string[] => {
    if (partials.length === 0) return []; // never touch history for an empty batch
    const newIds: string[] = [];
    commit(prev => {
      let runningFinish = prev.reduce((m, t) => Math.max(m, t.startDay + t.durationDays), 0);
      const built: ScheduleTask[] = partials.map(p => {
        const durationDays = p.durationDays ?? 1;
        const startDay = runningFinish > 0 ? runningFinish : 1;
        runningFinish = startDay + durationDays;
        const id = createId('task');
        newIds.push(id);
        return {
          id,
          title: p.title,
          phase: p.phase ?? 'General',
          durationDays,
          startDay,
          progress: 0,
          crew: '',
          dependencies: [],
          notes: '',
          status: 'not_started',
        };
      });
      const next = atIndex === undefined
        ? [...prev, ...built]
        : [...prev.slice(0, atIndex), ...built, ...prev.slice(atIndex)];
      return generateWbsCodes(next);
    });
    return newIds;
  },
  [commit],
);
```

- [ ] **Step 2: Pass it to `<SchedulerTabShell>`** in `schedule-pro.tsx` (alongside `onAddTask={handleAddTask}`, ~1532):

```tsx
            onAddTask={handleAddTask}
            onAddTasks={handleAddTasks}
```

- [ ] **Step 3: Thread through `SchedulerTabShell.tsx`** — add to `SchedulerTabShellProps` (near `onDeleteTask`):

```tsx
  /** Bulk-create tasks in one undo step (ghost row / paste / insert). */
  onAddTasks?: (partials: { title: string; durationDays?: number; phase?: string }[], atIndex?: number) => string[];
```

and in `renderTab`, pass it to `<GanttTab>` (alongside `onAddTask={props.onAddTask}`):

```tsx
        onAddTask={props.onAddTask}
        onAddTasks={props.onAddTasks}
```

- [ ] **Step 4: Thread through `GanttTab.tsx`** — add to `GanttTabProps` (near `onAddTask`):

```tsx
  /** Bulk-create tasks in one undo step (ghost row / paste / insert). */
  onAddTasks?: (partials: { title: string; durationDays?: number; phase?: string }[], atIndex?: number) => string[];
```

destructure it in the component signature (add `onAddTasks,` next to `onAddTask,`), and pass to the `split`-layout `<GridPane>` (alongside `onAddTask={onAddTask}`):

```tsx
            onAddTask={onAddTask}
            onAddTasks={onAddTasks}
```

- [ ] **Step 5: Add the prop + ghost-row state to `GridPane.tsx`** — in `GridPaneProps` (near `onAddTask`):

```tsx
  /** Bulk-create tasks in one undo step (ghost row / paste / insert). Returns new ids. */
  onAddTasks?: (partials: { title: string; durationDays?: number; phase?: string }[], atIndex?: number) => string[];
```

destructure `onAddTasks` in the component signature (next to `onAddTask`), and add ghost state near the other `useState` hooks (~350):

```tsx
  const [ghostDraft, setGhostDraft] = useState('');
  const ghostRef = useRef<TextInput>(null);

  // Commit the ghost row → append one task, clear the draft, keep focus so the
  // user can keep typing tasks. Empty/whitespace title is a no-op.
  const commitGhost = useCallback(() => {
    const title = ghostDraft.trim();
    if (!title) return;
    onAddTasks?.([{ title }]);
    setGhostDraft('');
    // The ghost input is a stable element (not keyed by task) so focus persists
    // across the re-render; re-assert it on web to be safe.
    if (Platform.OS === 'web') setTimeout(() => ghostRef.current?.focus(), 0);
  }, [ghostDraft, onAddTasks]);

  // Move focus from a real row's name cell into the ghost row (end of list).
  const focusGhost = useCallback(() => {
    setEditing(null);
    setTimeout(() => ghostRef.current?.focus(), 0);
  }, []);
```

- [ ] **Step 6: Enter-to-next on the name cell** — in `renderCell`'s `TextInput` `onKeyPress` (~797), replace the no-op Enter branch. The current branch reads:

```tsx
              else if (key === 'Enter' && !e.shiftKey) { /* handled by onSubmitEditing */ }
```

Replace it with:

```tsx
              else if (key === 'Enter' && !e.shiftKey) {
                e.preventDefault?.();
                if (col.key === 'name') {
                  if (!commitEdit()) return; // stay put if invalid
                  // Advance to the next task's name — or the ghost row at the end.
                  const nextRow = rowIndex + 1;
                  setTimeout(() => { nextRow < tasks.length ? beginEdit(nextRow, 'name') : focusGhost(); }, 0);
                } else {
                  // Excel-style: commit + down one row, same column. moveEdit does
                  // its OWN commitEdit — do NOT pre-commit here or moveEdit sees
                  // editing===null, its internal commit returns false, and it bails.
                  moveEdit('down');
                }
              }
```

(`onSubmitEditing={() => commitEdit()}` stays for native; on web the name-branch's second commit via onSubmitEditing no-ops because `editing` is already null.)

- [ ] **Step 7: Replace the footer "Add task" button with the ghost row** — swap the `TouchableOpacity` at ~1437 for a ghost row. It mirrors a normal row's left padding and lives in the same `ScrollView`:

```tsx
            {/* Ghost row: always-ready inline task entry. Not a member of
                `tasks`, so it's excluded from selection, bulk ops, hidden-ids,
                the context menu, and CPM. Enter/blur with a non-empty title
                appends a task and keeps focus for rapid list entry. */}
            <View style={styles.ghostRow} testID="grid-ghost-row">
              <TextInput
                ref={ghostRef}
                value={ghostDraft}
                onChangeText={setGhostDraft}
                placeholder="＋  Type a task name…"
                placeholderTextColor={themeColors.textSecondary}
                style={styles.ghostInput}
                onSubmitEditing={commitGhost}
                onBlur={commitGhost}
                returnKeyType="done"
                blurOnSubmit={false}
                testID="grid-ghost-input"
              />
            </View>
```

- [ ] **Step 8: Add the ghost styles** — in the `makeStyles` `StyleSheet.create({...})`, add (tokens only — no raw hex/fontSize/borderRadius literals):

```tsx
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border,
    backgroundColor: t.surface,
  },
  ghostInput: {
    flex: 1,
    ...Type.body,
    color: t.text,
    padding: 0,
  },
```

(If `makeStyles`'s param isn't named `t: ThemeColors`, match the file's existing name. `Type` is already imported; confirm `Type.body` exists in `constants/typography.ts` — it's used elsewhere in this file.)

- [ ] **Step 9: Verify + commit**

Run: `npx tsc --noEmit` → clean. Run: `bun run lint` → 0 errors, no new warnings in the touched files.

Owner visual review at merge (no jest for RN components): the grid ends in a ghost row; typing a name + Enter appends a task and re-focuses the ghost; Enter while editing a task's name jumps to the next task's name (and, on the last task, into the ghost); Enter in a duration/crew cell moves down one row; one Undo removes a ghost-created task.

```bash
git add app/schedule-pro.tsx components/schedule/SchedulerTabShell.tsx components/schedule/tabs/GanttTab.tsx components/schedule/GridPane.tsx
git commit -m "feat(scheduler): inline ghost row + Enter-to-next + bulk-create commit path"
```

---

### Task 3: Paste-rows + insert-anywhere

**Files:**
- Modify: `components/schedule/GridPane.tsx` (web `onPaste`; Insert above/below in `rowActions`; `⌘↵` insert-below; focus-after-insert effect)

**Context:** `rowActions(task)` (~366) returns the `ScheduleRowMenu` `RowMenuAction[]` (the inc-2 context menu): each is `{ key, label, destructive?, onPress }`. `openRowMenu(task)` opens it (native ActionSheet or web modal). Task order is array position; the anchor's array index is `tasks.findIndex(t => t.id === task.id)` (do NOT use the filtered render index — collapsed summaries can shift it). `onAddTasks(partials, atIndex?) => string[]` (Task 2) returns the created ids. `parsePastedRows` + `MAX_PASTE_ROWS` come from `@/utils/pasteRows` (Task 1).

- [ ] **Step 1: Import the parser** — at the top of `GridPane.tsx`, alongside the other `@/utils` imports:

```tsx
import { parsePastedRows } from '@/utils/pasteRows';
```

- [ ] **Step 2: Add a focus-after-insert effect** — near the ghost state (Task 2, ~350):

```tsx
  // After an insert, focus the new row's name cell once it appears in `tasks`.
  const pendingEditId = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingEditId.current;
    if (!id) return;
    const idx = tasks.findIndex(t => t.id === id);
    if (idx >= 0) {
      pendingEditId.current = null;
      setTimeout(() => beginEdit(idx, 'name'), 0);
    }
  }, [tasks, beginEdit]);
```

- [ ] **Step 3: Web paste handler** — add a shared handler near `commitGhost`:

```tsx
  // Web-only: pasting multiline text into the ghost / a name cell creates one
  // task per line in a single undo step. Single-line paste is left to the
  // browser so ordinary cell paste still works.
  const handleRowsPaste = useCallback((e: any) => {
    if (Platform.OS !== 'web') return;
    const text: string = e?.clipboardData?.getData?.('text') ?? '';
    if (!text || text.indexOf('\n') < 0) return; // let the browser handle single-line
    const rows = parsePastedRows(text);
    if (rows.length === 0) return;
    e.preventDefault?.();
    onAddTasks?.(rows);
    setGhostDraft('');
  }, [onAddTasks]);
```

- [ ] **Step 4: Wire `onPaste` onto the ghost input** — add to the ghost `<TextInput>` (Task 2, Step 7). RN-web forwards unknown DOM props, so cast through `any`:

```tsx
                {...(Platform.OS === 'web' ? ({ onPaste: handleRowsPaste } as any) : {})}
```

and onto the name cell's editing `<TextInput>` in `renderCell` (~785) the same way:

```tsx
            {...(Platform.OS === 'web' && col.key === 'name' ? ({ onPaste: handleRowsPaste } as any) : {})}
```

- [ ] **Step 5: Insert above/below in the context menu** — in `rowActions` (~366), append two actions before the destructive Delete:

```tsx
    { key: 'insert-above', label: 'Insert task above', onPress: () => insertRelativeTo(task, 0) },
    { key: 'insert-below', label: 'Insert task below', onPress: () => insertRelativeTo(task, 1) },
```

and define the helper near `commitGhost`:

```tsx
  // Insert a blank task at the anchor's array position (offset 0 = above,
  // 1 = below), then focus its name cell. Index comes from the anchor id, not
  // the filtered render index, so collapsed summaries can't misplace it.
  const insertRelativeTo = useCallback((anchor: ScheduleTask, offset: 0 | 1) => {
    const idx = tasks.findIndex(t => t.id === anchor.id);
    if (idx < 0) return;
    const [newId] = onAddTasks?.([{ title: '' }], idx + offset) ?? [];
    if (newId) pendingEditId.current = newId;
  }, [tasks, onAddTasks]);
```

- [ ] **Step 6: `⌘↵` / `Ctrl↵` = insert below on the name cell** — in the name cell `onKeyPress` (Task 2, Step 6), add a branch BEFORE the plain-Enter branch:

```tsx
              else if (key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault?.();
                if (!commitEdit()) return;
                const anchor = tasks[rowIndex];
                if (anchor) insertRelativeTo(anchor, 1);
              }
```

- [ ] **Step 7: Verify + commit**

Run: `npx tsc --noEmit` → clean. Run: `bun run lint` → 0 errors, no new warnings in touched files. Run: `bun run ship-check` → passes end-to-end (includes `test:paste-rows`).

Owner visual review at merge: paste a 5-line list into the ghost → 5 tasks in one Undo; paste a 3-column selection from Sheets → duration + phase populate; right-click a row → Insert task above / below creates and focuses a blank row; `⌘↵` while editing a name inserts a row below.

```bash
git add components/schedule/GridPane.tsx
git commit -m "feat(scheduler): paste-rows (Excel→tasks) + insert above/below + ⌘↵ insert"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → clean.
- [ ] `bun run lint` → 0 errors; no new warnings in touched files.
- [ ] `bun run scripts/validate-paste-rows.ts` → `13 passed`.
- [ ] `bun run ship-check` → passes end-to-end (includes `test:paste-rows`).
- [ ] **Owner visual review at merge (web, above 900px):**
  - [ ] Grid ends in an always-ready ghost row; typing + Enter appends and re-focuses the ghost.
  - [ ] Enter in a task's name jumps to the next task's name; on the last task it drops into the ghost. Enter in duration/crew moves down one row.
  - [ ] Paste a multiline list → one task per line, single Undo reverses the whole paste.
  - [ ] Paste tab-separated rows from a spreadsheet → duration + phase map across.
  - [ ] Right-click → Insert above / Insert below creates + focuses a blank row; `⌘↵` inserts below.

## Out of scope (deferred)
True drag-to-reorder rows (native gesture lib → future native build; Move up/down already covers reorder); native/phone paste-to-rows (phone keeps tap-to-add); fill-down, column reorder/hide, multi-cell range paste.
