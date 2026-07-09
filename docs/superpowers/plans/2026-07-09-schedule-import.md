# Schedule Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Excel `.xlsx` and Microsoft Project `.xml` (MSPDI) schedules fully into MAGE's Schedule Pro — tasks, durations, dates, FS/SS/FF/SF dependencies + lag, constraints, WBS, % complete, milestones, resources — validated by the existing CPM engine, replacing the current schedule after auto-snapshotting it as a baseline.

**Architecture:** Client picks the file (`expo-document-picker`) → a new Deno edge function `import-schedule` parses it (SheetJS for xlsx, MSPDI XML parser) and, for Excel, uses Gemini to detect the column mapping → returns a normalized `ScheduleImportResult` → a preview screen (`app/schedule-import.tsx`) lets the user confirm the mapping → a **pure** `utils/scheduleImport.ts` maps rows to `ScheduleTask[]` → `runCpm()` validates → the current schedule is captured as a baseline and replaced.

**Tech Stack:** Expo/React Native, TypeScript strict, Deno edge functions, Gemini (`gemini-2.5-flash`), SheetJS, `expo-document-picker`/`expo-file-system` (already installed). No new native modules — OTA-safe.

**Conventions:** bun; `npx tsc --noEmit`; NO jest — pure-fn validators via `scripts/validate-*.ts` wired into `bun run ship-check`; all Supabase writes via `utils/offlineQueue.ts` `supabaseWrite`; types in `types/index.ts`; tier gating via `hooks/useTierAccess.ts` + server `requireTier` + `MONTHLY_CAPS`; amber brand + `lucide-react-native` + `useThemedStyles`. Branch `claude/scheduler-import-scanner` — commit per task; do NOT merge/deploy/apply-migration.

---

## File Structure

| File | Responsibility |
|---|---|
| `types/index.ts` | Add import DTOs (`ColumnMapping`, `ImportedScheduleRow`, `ScheduleImportResult`, `ScheduleImportWarning`, `ScheduleImportField`). |
| `utils/scheduleImport.ts` | **Pure** mapper: `mapRowsToScheduleTasks`, duration/date/predecessor parsing, MSPDI constant tables, WBS rebuild, dangling-dep healing. |
| `scripts/validate-schedule-import.ts` | Pure-fn validator (assert mapping/parsing correctness). Wired into ship-check. |
| `supabase/functions/import-schedule/index.ts` | Deno edge fn: format detect, SheetJS xlsx parse, Gemini column-detect, MSPDI parse, normalize → `ScheduleImportResult`. Pro-gated, metered. |
| `supabase/functions/_shared/auth.ts` | Add `schedule_import` to `MONTHLY_CAPS` (all 4 tiers). |
| `hooks/useTierAccess.ts` | Add `FeatureKey` `'schedule_import'` → `pro`. |
| `app/schedule-import.tsx` | Preview/mapping screen: pick → invoke → confirm mapping (Excel) → preview → import (CPM validate → baseline → replace). |
| `app/schedule-pro.tsx` | Add an "Import schedule" entry point. |
| `app/_layout.tsx` | Register the `schedule-import` route. |

**Build order:** pure core first (Tasks 1–3, fully testable with no backend), then the edge fn (Task 4), then gating (Task 5), then the screen + wiring (Tasks 6–8), then the final gate (Task 9).

---

## Task 1: Import DTO types

**Files:**
- Modify: `types/index.ts` (add near the other schedule types, ~line 828 after `ProjectSchedule`)

- [ ] **Step 1: Add the types**

```ts
// ─── Schedule Import (Excel .xlsx + MS Project XML) ───────────────────────
export type ScheduleImportField =
  | 'title' | 'durationDays' | 'startDate' | 'finishDate' | 'predecessors'
  | 'progress' | 'wbs' | 'outlineLevel' | 'resource' | 'notes'
  | 'milestone' | 'constraintType' | 'constraintDate';

/** Excel: field → 0-based column index (null = unmapped). */
export type ColumnMapping = Partial<Record<ScheduleImportField, number | null>>;

/** One parsed source row, normalized. MSPDI arrives fully populated; Excel is
 *  resolved through ColumnMapping into this same shape by the mapper. */
export interface ImportedScheduleRow {
  sourceId: string;            // MSPDI UID or Excel row index — stable within the file
  title: string;
  rawDuration?: string;        // "PT40H0M0S" | "5 days" | "3d" | "4"
  rawStart?: string;           // ISO or locale date string
  rawFinish?: string;
  rawPredecessors?: string;    // "3FS+2d, 5SS" (Excel) or serialized MSPDI links
  progress?: number;           // 0..100
  wbs?: string;
  outlineLevel?: number;       // 0 = top-level
  resource?: string;
  notes?: string;
  milestone?: boolean;
  constraintType?: number;     // MSPDI 0..7
  constraintDate?: string;     // ISO
}

export interface ScheduleImportWarning {
  code: string;                // 'dangling_dep' | 'unmapped_field' | 'bad_date' | 'truncated' | ...
  message: string;
  sourceId?: string;
}

export interface ScheduleImportResult {
  format: 'xlsx' | 'msproject_xml';
  rawColumns?: string[];       // Excel header row (for the mapping UI)
  mapping?: ColumnMapping | null;
  rows: ImportedScheduleRow[];
  warnings: ScheduleImportWarning[];
  truncated?: boolean;
}
```

- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit`. Expected: 0 errors.
- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "types(schedule-import): import DTOs (ColumnMapping, ImportedScheduleRow, ScheduleImportResult)"
```

---

## Task 2: Pure mapper `utils/scheduleImport.ts` (validator-first)

**Files:**
- Create: `utils/scheduleImport.ts`
- Reference (do not modify): `utils/scheduleEngine.ts` (`createId`, `PHASE_OPTIONS`), `utils/cpm.ts` (`workingDaysBetween`), `types/index.ts` (`ScheduleTask`, `DependencyLink`, `AnchorType`).

**Context the implementer must honor:**
- `ScheduleTask` fields to populate: `id`, `title`, `phase`, `durationDays`, `startDay`, `progress`, `crew`, `dependencyLinks`, `notes`, `status:'not_started'`, `isMilestone`, `wbsCode`, `parentId`, `outlineLevel`, `isSummary`, `anchorType`, `anchorDate`, `resourceIds`.
- `DependencyLink = { taskId: string; type?: 'FS'|'SS'|'FF'|'SF'; lagDays: number }`.
- `AnchorType` union is defined at `types/index.ts:445–453` — read it and map exactly.

- [ ] **Step 1: Write the constant tables + parsers**

```ts
// utils/scheduleImport.ts — PURE. No I/O, no imports from React/Supabase.
import type {
  ScheduleTask, DependencyLink, ImportedScheduleRow, ScheduleImportWarning,
} from '@/types';
import { createId } from '@/utils/scheduleEngine';

// MSPDI PredecessorLink.Type → MAGE dependency type.
export const MSPDI_LINK_TYPE: Record<number, DependencyLink['type']> = {
  0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS',
};

// MSPDI ConstraintType → MAGE anchorType. (Match the AnchorType union exactly.)
export const MSPDI_CONSTRAINT_TYPE: Record<number, string> = {
  0: 'asap', 1: 'alap', 2: 'must-start-on', 3: 'must-finish-on',
  4: 'start-no-earlier', 5: 'start-no-later', 6: 'finish-no-earlier', 7: 'finish-no-later',
};

const HOURS_PER_DAY = 8;

/** Parse a duration string to whole working days (>=0). Handles MSPDI ISO-8601
 *  (PT40H0M0S = 40h/8 = 5d) and Excel free text ("5 days","3d","2 wks","4"). */
export function parseDurationDays(raw: string | undefined): number {
  if (!raw) return 1;
  const s = String(raw).trim().toLowerCase();
  const iso = s.match(/^pt(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (iso) { const h = parseFloat(iso[1] ?? '0'); return Math.max(0, Math.round(h / HOURS_PER_DAY)); }
  const num = parseFloat(s.replace(/[^0-9.]/g, '')) || 0;
  if (/w(ee)?k/.test(s)) return Math.max(0, Math.round(num * 5));
  if (/h(ou)?r/.test(s)) return Math.max(0, Math.round(num / HOURS_PER_DAY));
  return Math.max(0, Math.round(num));
}

/** Parse "3FS+2d, 5SS-1d" or "3,5" → [{ sourceId, type, lagDays }]. */
export function parsePredecessorString(raw: string | undefined):
  { sourceId: string; type: DependencyLink['type']; lagDays: number }[] {
  if (!raw) return [];
  return String(raw).split(/[,;]/).map(tok => tok.trim()).filter(Boolean).map(tok => {
    const m = tok.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?/i);
    if (!m) return null;
    const lag = m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0;
    return { sourceId: m[1], type: (m[2]?.toUpperCase() as DependencyLink['type']) ?? 'FS', lagDays: lag };
  }).filter((x): x is { sourceId: string; type: DependencyLink['type']; lagDays: number } => x !== null);
}
```

- [ ] **Step 2: Write `mapRowsToScheduleTasks`**

```ts
export interface MapOptions { scheduleStartDate: string; workingDaysPerWeek: number }

export function mapRowsToScheduleTasks(
  rows: ImportedScheduleRow[],
  opts: MapOptions,
): { tasks: ScheduleTask[]; warnings: ScheduleImportWarning[] } {
  const warnings: ScheduleImportWarning[] = [];
  // 1. First pass: create tasks + a sourceId → newId map (drop empty-title rows).
  const idBySource = new Map<string, string>();
  const kept = rows.filter(r => (r.title ?? '').trim().length > 0);
  if (kept.length < rows.length) warnings.push({ code: 'empty_title', message: `${rows.length - kept.length} row(s) had no task name and were skipped.` });
  for (const r of kept) idBySource.set(r.sourceId, createId('task'));

  // 2. Second pass: build ScheduleTask, remapping predecessor sourceIds → newIds.
  const startEpoch = Date.parse(opts.scheduleStartDate);
  const tasks: ScheduleTask[] = kept.map(r => {
    const durationDays = r.milestone ? 0 : parseDurationDays(r.rawDuration);
    const startDay = computeStartDay(r.rawStart, startEpoch, opts) ?? 1;
    const preds = parsePredecessorString(r.rawPredecessors);
    const dependencyLinks: DependencyLink[] = [];
    for (const p of preds) {
      const target = idBySource.get(p.sourceId);
      if (!target) { warnings.push({ code: 'dangling_dep', message: `Predecessor ${p.sourceId} not found; link dropped.`, sourceId: r.sourceId }); continue; }
      dependencyLinks.push({ taskId: target, type: p.type, lagDays: p.lagDays });
    }
    return {
      id: idBySource.get(r.sourceId)!,
      title: r.title.trim(),
      phase: 'General',
      durationDays,
      startDay,
      progress: clamp(r.progress ?? 0, 0, 100),
      crew: r.resource ?? '',
      dependencies: dependencyLinks.map(d => d.taskId), // legacy mirror
      dependencyLinks,
      notes: r.notes ?? '',
      status: 'not_started',
      isMilestone: durationDays === 0 || !!r.milestone,
      wbsCode: r.wbs,
      outlineLevel: r.outlineLevel,
      ...(r.constraintType != null && MSPDI_CONSTRAINT_TYPE[r.constraintType]
        ? { anchorType: MSPDI_CONSTRAINT_TYPE[r.constraintType] as ScheduleTask['anchorType'], anchorDate: r.constraintDate }
        : {}),
      ...(r.resource ? { resourceIds: [] } : {}),
    } as ScheduleTask;
  });

  // 3. Rebuild parent/child from outlineLevel (nearest preceding lower level = parent).
  assignParents(tasks, warnings);
  return { tasks, warnings };
}
```

- [ ] **Step 3: Write the helpers** (`computeStartDay`, `clamp`, `assignParents`)

```ts
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

/** Working-day offset (1-indexed) of a date from the schedule start. Naive
 *  calendar-day delta then compressed to the work week is acceptable for v1. */
function computeStartDay(rawStart: string | undefined, startEpoch: number, opts: MapOptions): number | null {
  if (!rawStart) return null;
  const t = Date.parse(rawStart);
  if (Number.isNaN(t) || Number.isNaN(startEpoch)) return null;
  const calDays = Math.round((t - startEpoch) / 86_400_000);
  if (calDays <= 0) return 1;
  const wpw = opts.workingDaysPerWeek || 7;
  const weeks = Math.floor(calDays / 7), rem = calDays % 7;
  return weeks * wpw + Math.min(rem, wpw) + 1;
}

/** parentId from outlineLevel: nearest earlier task with a strictly lower level. */
function assignParents(tasks: (ScheduleTask & { outlineLevel?: number })[], warnings: ScheduleImportWarning[]) {
  const stack: ScheduleTask[] = [];
  for (const t of tasks) {
    const lvl = t.outlineLevel ?? 0;
    while (stack.length && ((stack[stack.length - 1].outlineLevel ?? 0) >= lvl)) stack.pop();
    t.parentId = stack.length ? stack[stack.length - 1].id : undefined;
    stack.push(t);
  }
  // Mark parents as summaries (CPM ignores their author duration).
  const parentIds = new Set(tasks.map(t => t.parentId).filter(Boolean) as string[]);
  for (const t of tasks) if (parentIds.has(t.id)) t.isSummary = true;
}
```

- [ ] **Step 4: Typecheck** — Run `npx tsc --noEmit`. Expected: 0 errors. (If `AnchorType` values differ from the strings above, fix `MSPDI_CONSTRAINT_TYPE` to the exact union members.)
- [ ] **Step 5: Commit**

```bash
git add utils/scheduleImport.ts
git commit -m "feat(schedule-import): pure row→ScheduleTask mapper + MSPDI/duration/predecessor parsing"
```

---

## Task 3: Validator `scripts/validate-schedule-import.ts`

**Files:**
- Create: `scripts/validate-schedule-import.ts`
- Modify: `package.json` (add `test:schedule-import` to the `ship-check` chain — read the existing `ship-check` script and append `bun run scripts/validate-schedule-import.ts`).
- Reference: an existing validator (e.g. `scripts/validate-wip.ts`) for the assert/exit-code style.

- [ ] **Step 1: Write the validator** (follow the existing validators' `assert(cond, msg)` + process.exit(1) pattern)

```ts
import { mapRowsToScheduleTasks, parseDurationDays, parsePredecessorString, MSPDI_LINK_TYPE, MSPDI_CONSTRAINT_TYPE } from '@/utils/scheduleImport';
import type { ImportedScheduleRow } from '@/types';
let failed = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('✗', m); failed++; } };

// Duration parsing
assert(parseDurationDays('PT40H0M0S') === 5, 'PT40H = 5d @ 8h');
assert(parseDurationDays('2 wks') === 10, '2 wks = 10d');
assert(parseDurationDays('3d') === 3, '3d = 3');
assert(parseDurationDays('4') === 4, 'bare 4 = 4');
assert(parseDurationDays(undefined) === 1, 'missing = 1');

// Link + constraint tables
assert(MSPDI_LINK_TYPE[1] === 'FS' && MSPDI_LINK_TYPE[3] === 'SS' && MSPDI_LINK_TYPE[0] === 'FF' && MSPDI_LINK_TYPE[2] === 'SF', 'link types');
assert(MSPDI_CONSTRAINT_TYPE[4] === 'start-no-earlier' && MSPDI_CONSTRAINT_TYPE[7] === 'finish-no-later', 'constraint types');

// Predecessor parsing
const p = parsePredecessorString('3FS+2d, 5SS');
assert(p.length === 2 && p[0].type === 'FS' && p[0].lagDays === 2 && p[1].type === 'SS', 'predecessor parse');

// Mapping: dangling dep dropped + warned; links remapped to new ids
const rows: ImportedScheduleRow[] = [
  { sourceId: '1', title: 'A', rawDuration: '2d', rawStart: '2026-01-01' },
  { sourceId: '2', title: 'B', rawDuration: '3d', rawStart: '2026-01-03', rawPredecessors: '1FS, 9FS' },
  { sourceId: '3', title: '', rawDuration: '1d' }, // empty title → skipped
];
const { tasks, warnings } = mapRowsToScheduleTasks(rows, { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 7 });
assert(tasks.length === 2, 'empty-title row skipped');
const b = tasks.find(t => t.title === 'B')!;
assert(b.dependencyLinks!.length === 1 && b.dependencyLinks![0].taskId === tasks[0].id, 'valid link remapped to new id');
assert(warnings.some(w => w.code === 'dangling_dep'), 'dangling dep warned');
assert(warnings.some(w => w.code === 'empty_title'), 'empty title warned');

// Milestone: 0-duration
const ms = mapRowsToScheduleTasks([{ sourceId: '1', title: 'M', milestone: true }], { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 7 }).tasks[0];
assert(ms.durationDays === 0 && ms.isMilestone === true, 'milestone 0-duration');

if (failed) { console.error(`\n${failed} schedule-import checks failed`); process.exit(1); }
console.log('✓ schedule-import validator passed');
```

- [ ] **Step 2: Run it** — `bun run scripts/validate-schedule-import.ts`. Expected: `✓ schedule-import validator passed`.
- [ ] **Step 3: Wire into ship-check** (append to the `ship-check` script in `package.json`).
- [ ] **Step 4: Run** `bun run ship-check`. Expected: ALL PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/validate-schedule-import.ts package.json
git commit -m "test(schedule-import): pure mapper validator wired into ship-check"
```

---

## Task 4: Edge function `import-schedule`

**Files:**
- Create: `supabase/functions/import-schedule/index.ts`
- Reference: `supabase/functions/analyze-photos/index.ts` (CORS, `requireTier`, `aiUsageIncrement`, `MONTHLY_CAPS`, Gemini call shape), `supabase/functions/_shared/auth.ts`.

**Contract (must match `ScheduleImportResult` from Task 1):** input `{ fileBase64?: string, fileText?: string, filename: string }`; output the `ScheduleImportResult` shape.

- [ ] **Step 1: Scaffold + auth + validation** — copy the CORS + `requireTier(req, ['pro'], 'schedule_import')` + JSON-body pattern from `analyze-photos`. Reject payloads > 8 MB and filenames not ending `.xlsx`/`.xml` with a 400.

- [ ] **Step 2: Format detection**

```ts
// xlsx files are ZIP archives → first bytes are "PK\x03\x04". MSPDI is XML.
function detectFormat(bytes: Uint8Array, text: string | undefined, filename: string): 'xlsx' | 'msproject_xml' | null {
  if (filename.toLowerCase().endsWith('.xlsx') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return 'xlsx';
  if ((text ?? '').includes('http://schemas.microsoft.com/project') || filename.toLowerCase().endsWith('.xml')) return 'msproject_xml';
  return null;
}
```

- [ ] **Step 3: xlsx parse + Gemini column-detect**

```ts
import * as XLSX from 'https://esm.sh/xlsx@0.20.3';
// ... decode base64 → Uint8Array → XLSX.read(bytes, {type:'array'})
// pick sheet with most rows; header = row 0; data rows = rest (cap 1000, set truncated).
// Build rows as ImportedScheduleRow AFTER we know the mapping.
```
Gemini prompt (system): "You are mapping spreadsheet columns to a construction schedule import. Given the header row and sample rows, return JSON `{ title, durationDays, startDate, finishDate, predecessors, progress, wbs, outlineLevel, resource, notes }` where each value is the 0-based column index or null. Return indices only." Model `gemini-2.5-flash`, `responseMimeType:'application/json'`, temperature 0. Wrap `JSON.parse` in try/catch → on failure return `mapping:null` (client falls back to manual). Then materialize `ImportedScheduleRow[]` by reading the mapped columns per data row (Excel `sourceId` = row index string).

- [ ] **Step 4: MSPDI parse** — parse the XML `<Task>` elements (regex/`deno-dom`) into `ImportedScheduleRow`: `UID`→sourceId, `Name`→title, `Duration`→rawDuration, `Start`→rawStart, `PercentComplete`→progress, `OutlineLevel`→outlineLevel, `WBS`→wbs, `ConstraintType`/`ConstraintDate`, `Milestone`, and serialize each `<PredecessorLink>` (`PredecessorUID`+`Type`+`LinkLag`) into `rawPredecessors` as `"<UID><TYPE>+<lag>d"` so the same `parsePredecessorString` handles it. `mapping` is omitted (auto-mapped).

- [ ] **Step 5: Meter + return** — after validation, before Gemini (xlsx only): `const used = await aiUsageIncrement(auth.userId,'schedule_import'); if (used > MONTHLY_CAPS[auth.tier].schedule_import) return 429`. Return `ScheduleImportResult`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/import-schedule/index.ts
git commit -m "feat(schedule-import): import-schedule edge fn (SheetJS + Gemini col-detect + MSPDI parse)"
```

---

## Task 5: Tier gating + caps

**Files:**
- Modify: `hooks/useTierAccess.ts` (add `'schedule_import'` to the `FeatureKey` union + its tier map → `pro`).
- Modify: `supabase/functions/_shared/auth.ts` (`MONTHLY_CAPS`: add `schedule_import` to all 4 tiers — `free:0, pro:20, business:60, enterprise:150`).

- [ ] **Step 1** Add the FeatureKey mapping. **Step 2** Add the caps. **Step 3** `npx tsc --noEmit` = 0. **Step 4** Commit `feat(schedule-import): Pro-tier gate + monthly caps`.

---

## Task 6: Import screen `app/schedule-import.tsx`

**Files:**
- Create: `app/schedule-import.tsx`
- Reference: `app/data-import.tsx` (document-picker + read pattern), `app/schedule-pro.tsx` (how it loads a project's schedule + calls `updateProject`), `utils/scheduleOps.ts` (`captureBaseline`), `utils/cpm.ts` (`runCpm`), `utils/scheduleImport.ts` (Task 2), `hooks/useTierAccess.ts`.

- [ ] **Step 1: Build the flow** (single screen, `useThemedStyles`, amber, lucide, modal-in-screen back):
  1. `useTierAccess('schedule_import')` gate → Paywall if not Pro+.
  2. `expo-document-picker` (`type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/xml','application/xml']`) → read via `expo-file-system` (`.xlsx` as base64, `.xml` as UTF-8) → `supabase.functions.invoke('import-schedule', { fileBase64|fileText, filename })`.
  3. **Excel:** render each `ScheduleImportField` as a labeled dropdown over `result.rawColumns`, preselected from `result.mapping`; **XML:** skip mapping. Live preview table of the first 15 mapped rows.
  4. Show `result.warnings`.
  5. **Import** button (disabled until `title`+`startDate` mapped for Excel): call `mapRowsToScheduleTasks(rows, { scheduleStartDate: schedule.startDate ?? todayISO, workingDaysPerWeek: schedule.workingDaysPerWeek })` → `runCpm(tasks, {...})` → if `conflicts.length` show a non-blocking confirm ("N cycles/anchor conflicts — import anyway?").
  6. On confirm: `const withBaseline = captureBaseline(currentSchedule, 'Before import — ' + todayHuman)` → `updateProject(projectId, { schedule: { ...withBaseline, tasks: mappedTasks, resources: mergedResources } })` → toast → `router.back()`.

- [ ] **Step 2:** For Excel, resolving mapped columns into `ImportedScheduleRow` happens client-side using the confirmed `mapping` (the edge fn returned raw rows + its suggested mapping; re-materialize rows when the user overrides a column). Keep this in a small local helper `applyMapping(rawRows, mapping)` inside the screen.
- [ ] **Step 3:** `npx tsc --noEmit` = 0; `bun run lint` = 0.
- [ ] **Step 4: Commit** `feat(schedule-import): import preview + mapping screen`.

---

## Task 7: Entry point in Schedule Pro

**Files:**
- Modify: `app/schedule-pro.tsx` (add an "Import schedule" action — a row in the existing `ExportSheet`/menu, or a header button — that `router.push('/schedule-import?projectId=' + projectId)`).

- [ ] **Step 1** Add the entry (lucide `FileInput` or `Upload` icon, amber). **Step 2** `npx tsc --noEmit` = 0. **Step 3** Commit `feat(schedule-import): entry point in Schedule Pro`.

---

## Task 8: Route registration

**Files:**
- Modify: `app/_layout.tsx` (add `<Stack.Screen name="schedule-import" options={{ presentation: 'modal', title: 'Import Schedule' }} />` alongside the other schedule routes).

- [ ] **Step 1** Add the screen. **Step 2** `npx tsc --noEmit` = 0 (typed routes must resolve `/schedule-import`). **Step 3** Commit `feat(schedule-import): register route`.

---

## Task 9: Final gate

- [ ] **Step 1** `npx tsc --noEmit` = 0. **Step 2** `bun run lint` = 0. **Step 3** `bun run ship-check` = ALL PASS. **Step 4** Capture simulator screenshots of the import screen (mapping, preview, warnings) + post-import Gantt. **Step 5** Commit any lint fixes: `chore(schedule-import): final gate green`.

---

## Self-Review notes (author)
- **Spec coverage:** every §4 component → a task (types T1, mapper T2, validator T3, edge fn T4, gating T5, screen T6, entry T7, route T8, gate T9). MSPDI + Excel both covered in T4; replace+baseline in T6.
- **Type consistency:** `ScheduleImportResult`/`ColumnMapping`/`ImportedScheduleRow` defined in T1, consumed identically in T2/T4/T6. `mapRowsToScheduleTasks` signature stable T2→T3→T6.
- **Deferred (per spec):** native `.mpp`, round-trip export, merge mode — not tasks here.
- **Verify at build time:** the exact `AnchorType` union members (T2 constraint table) and the exact `ship-check` script text (T3) — read the live files; adjust to match.
