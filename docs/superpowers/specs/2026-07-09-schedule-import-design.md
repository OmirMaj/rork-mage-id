# Schedule Import (Excel .xlsx + Microsoft Project XML) — Design

**Status:** Approved (design), pending spec review.
**Goal:** Let a GC bring an existing Excel or Microsoft Project schedule fully into MAGE's Schedule Pro — tasks, durations, dates, dependencies (FS/SS/FF/SF + lag), constraints, WBS outline, % complete, milestones, resources — validated by the existing CPM engine. This removes the single biggest switching-cost objection for shops already living in MS Project / P6 / Excel.

**Tier:** Pro+ (Schedule Pro is a Pro feature; the AI column-detection call is metered). *Flagged for owner confirmation.*

---

## 1. Why this is small (the key insight)

MAGE's `ScheduleTask` model (`types/index.ts:455–552`) is already a **near-superset of Microsoft Project's task model**:

| MS Project concept | Already in MAGE |
|---|---|
| Predecessor links FS/SS/FF/SF + lag/lead | `dependencyLinks: DependencyLink[]` (`type`, `lagDays`) |
| Constraint types (SNET/SNLT/FNET/FNLT/MSO/MFO/ALAP/ASAP) | `anchorType` + `anchorDate` |
| WBS / outline hierarchy | `wbsCode`, `parentId`, `outlineLevel`, `isSummary` |
| Baseline start/finish | `baselineStartDay/EndDay` + `ProjectSchedule.baselines[]` |
| % complete, milestones, LOE/hammock | `progress`, `isMilestone`, `isLevelOfEffort` |
| Resources / calendars | `resources[]`, `resourceIds`, `resourceCalendars[]`, `workingDaysPerWeek`, `nonWorkingDates[]` |

So importing is **parse → map → validate**, not a model redesign. The CPM engine (`utils/cpm.ts` `runCpm()`) already detects cycles, anchor violations, and resource overallocation on the mapped result.

## 2. Scope

**In scope (v1):**
- Import a `.xlsx` (Excel) **or** `.xml` (MS Project 2003+ MSPDI export) file into a **single existing project's** schedule.
- Excel: **AI column detection** (Gemini) with a user confirm/override step (Excel has no fixed layout).
- MS Project XML: structured auto-map (no AI needed).
- Import behavior: **REPLACE** the project's current schedule, after **auto-capturing the existing schedule as a named baseline** (`"Before import — <date>"`) so nothing is lost.
- Post-map **CPM validation** surfacing cycles / anchor conflicts / dangling deps before commit.

**Out of scope (explicitly deferred):**
- Native `.mpp` binary (proprietary; needs a server-side MPXJ/paid converter) — future phase.
- Primavera P6 `.xer`/XML — future phase (the same edge-fn pattern extends to it).
- Round-trip **export** back to MS Project XML — natural complement, future phase (MAGE already exports CSV/PDF/iCal).
- Merge/append import mode — deferred; v1 is replace-only (owner chose this).

## 3. Architecture

```
app/schedule-pro.tsx  ──"Import schedule"──►  app/schedule-import.tsx (preview screen)
                                                    │
  expo-document-picker → expo-file-system read      │  base64 (xlsx) / text (xml)
                                                    ▼
                                   supabase.functions.invoke('import-schedule')
                                                    │
                    ┌───────────────────────────────┴───────────────────────────┐
                    │  Deno edge fn: import-schedule (Pro-gated, metered)         │
                    │   1. detect format (xlsx zip magic / <Project> xml root)    │
                    │   2. xlsx → SheetJS parse → headers + rows                  │
                    │        → Gemini column-detect → ColumnMapping              │
                    │      xml  → parse MSPDI → structured rows (auto-mapped)     │
                    │   3. return { format, rawColumns, mapping, rows, warnings } │
                    └───────────────────────────────┬───────────────────────────┘
                                                    ▼
              app/schedule-import.tsx: show mapping (editable for Excel) + preview + warnings
                                                    │  user confirms
                                                    ▼
        utils/scheduleImport.ts  mapRowsToScheduleTasks(rows, mapping, {scheduleStartDate,...})
                                                    │  ScheduleTask[]
                                                    ▼
              runCpm(tasks) → surface conflicts; captureBaseline(current) → replace tasks
                                                    ▼
                    updateProject(projectId, { schedule }) → supabaseWrite → Supabase/AsyncStorage
```

**Why the edge function parses (not the client):** keeps the app **OTA-safe** — SheetJS + the XML parser are ~heavy and would otherwise bloat the JS bundle / risk native issues. `expo-document-picker` + `expo-file-system` (already present) do the pick + read; everything else is server-side Deno.

## 4. Components (files)

### 4.1 `supabase/functions/import-schedule/index.ts` (new, Deno)
- **Auth:** `requireTier(req, ['pro'], 'schedule_import')`.
- **Metering:** `aiUsageIncrement(userId, 'schedule_import')` **only when the Gemini column-detect path runs** (Excel). MS Project XML parse is deterministic → not metered (no AI cost). Cap checked against `MONTHLY_CAPS[tier].schedule_import` **after** input validation, **before** the Gemini call.
- **Input:** `{ fileBase64?: string, fileText?: string, filename: string }`. `.xlsx` → base64; `.xml` → text (or base64, decoded server-side).
- **Format detection:** `.xlsx` = ZIP (`PK\x03\x04` magic); MSPDI = XML whose root is `<Project xmlns="http://schemas.microsoft.com/project">`.
- **xlsx parse:** SheetJS (`https://esm.sh/xlsx@0.20.x`) → first sheet (or the sheet with the most task-like rows) → `{ headers: string[], rows: string[][] }`. Cap: first 1,000 data rows (warn if truncated).
- **AI column detection (xlsx only):** send `headers` + first 5 rows to Gemini (`gemini-2.5-flash`, `responseMimeType: application/json`) → returns `ColumnMapping` (field → column index or null). Prompt enumerates the target fields with descriptions; asks for best-guess indices + a `confidence` per field. Wrapped in try/catch; on failure returns `mapping: null` so the client falls back to manual mapping (no hard error).
- **MSPDI parse:** parse XML (Deno `deno-dom` or a small hand-rolled parser over the well-defined MSPDI subset — no arbitrary XML, only the `<Task>` and `<Calendar>` elements we read) → structured `ImportedScheduleRow[]` with fields already identified (see §6).
- **SSRF:** no URL fetching in this fn (file comes inline) → no `urlGuard` needed, but it still validates payload size (reject > ~8 MB, Supabase Functions limit) and rejects non-xlsx/xml.
- **Output:** `ScheduleImportResult` = `{ format: 'xlsx'|'msproject_xml', rawColumns?: string[], mapping?: ColumnMapping, rows: ImportedScheduleRow[], warnings: ScheduleImportWarning[], truncated?: boolean }`. **Never** applies anything server-side — pure parse+suggest; the client owns the commit.

### 4.2 `utils/scheduleImport.ts` (new, PURE — validator-tested)
- `mapRowsToScheduleTasks(rows: ImportedScheduleRow[], mapping: ColumnMapping | null, opts: { scheduleStartDate: string; workingDaysPerWeek: number; existingIds: Set<string> }): { tasks: ScheduleTask[]; warnings: ScheduleImportWarning[] }`
- Responsibilities (all pure, deterministic, no I/O):
  - Resolve each row's fields via `mapping` (Excel) or direct (MSPDI already normalized).
  - **Duration** parse: MSPDI ISO-8601 (`PT40H0M0S` = hours ÷ hours-per-day, or `<Duration>` with `DurationFormat`) and Excel free-text (`"5 days"`, `"5d"`, `"2 wks"`, bare number) → `durationDays` (working days). Guard: min 0 for milestones, else ≥ 1.
  - **Dates → `startDay`**: parse the start date, compute working-day offset from `opts.scheduleStartDate` (reuse `workingDaysBetween` semantics). Finish is derived, not stored.
  - **Dependencies**: parse predecessor references (MSPDI `<PredecessorLink>` UID+Type+LinkLag; Excel `"3FS+2d, 5SS"` shorthand) → `dependencyLinks[]` with correct FS/SS/FF/SF + `lagDays`. **Remap source IDs → new MAGE task IDs.** Drop links to unknown tasks → warning.
  - **Constraints**: MSPDI `ConstraintType` (0–7) + `ConstraintDate` → `anchorType` + `anchorDate`. Excel constraint columns if present.
  - **WBS**: rebuild `parentId` / `outlineLevel` / `wbsCode` / `isSummary` from OutlineLevel (MSPDI) or WBS-code prefixes (Excel). Summary tasks get `isSummary: true` (CPM ignores their author duration).
  - **% / milestone / LOE**: `progress` (0–100), `isMilestone` (0-duration or MSPDI `<Milestone>1`), `isLevelOfEffort`.
  - **Resources**: collect distinct resource/crew names → create `ProjectResource` entries + set `crew` + `resourceIds`. (Sub-matching to existing subcontractors is a warning-level suggestion, not automatic.)
  - **Phase**: map source category/name heuristics → `PHASE_OPTIONS`, else `'General'`.
  - **Cycle pre-check** is left to `runCpm()` at the screen layer (single source of truth); the mapper only drops **dangling** links.
- Also exports the mapping constant tables (`MSPDI_LINK_TYPE`, `MSPDI_CONSTRAINT_TYPE`) so the validator can assert them.

### 4.3 `types/index.ts` additions
```ts
type ScheduleImportField =
  | 'title' | 'durationDays' | 'startDate' | 'finishDate' | 'predecessors'
  | 'progress' | 'wbs' | 'outlineLevel' | 'resource' | 'notes' | 'milestone' | 'constraintType' | 'constraintDate';
interface ColumnMapping { [field in ScheduleImportField]?: number | null }   // field → column index
interface ImportedScheduleRow {
  sourceId: string;              // MSPDI UID or Excel row index (stable within the file)
  title: string; rawDuration?: string; rawStart?: string; rawFinish?: string;
  rawPredecessors?: string; progress?: number; wbs?: string; outlineLevel?: number;
  resource?: string; notes?: string; milestone?: boolean;
  constraintType?: number; constraintDate?: string;
}
interface ScheduleImportWarning { code: string; message: string; sourceId?: string }
interface ScheduleImportResult {
  format: 'xlsx' | 'msproject_xml';
  rawColumns?: string[]; mapping?: ColumnMapping | null;
  rows: ImportedScheduleRow[]; warnings: ScheduleImportWarning[]; truncated?: boolean;
}
```

### 4.4 `app/schedule-import.tsx` (new screen/modal)
- Reached from `schedule-pro.tsx` (an "Import schedule" row in the existing `ExportSheet`, renamed to a "Data" sheet, or a header button).
- Steps: (1) pick file → invoke edge fn (loading state) → (2) **Excel:** show the AI-detected mapping as labeled dropdowns over `rawColumns` (each target field, with the AI's guess preselected + confidence hint) + a live preview table of the first ~15 mapped rows; **MSP XML:** skip mapping, straight to preview. (3) Show `warnings`. (4) **Import** button → `mapRowsToScheduleTasks` → `runCpm()` → if conflicts, show a non-blocking summary ("2 dependency cycles found — import anyway / cancel"). (5) On confirm: `captureBaseline(currentSchedule, 'Before import — <date>')`, replace `schedule.tasks` + merged `resources`, `updateProject(...)`, toast, navigate back to Schedule Pro.
- Follows the modal-in-screen + `useThemedStyles`/amber/lucide conventions.

### 4.5 Gating + metering wiring
- `hooks/useTierAccess.ts`: new `FeatureKey` `'schedule_import'` → `pro`.
- `supabase/functions/_shared/auth.ts` `MONTHLY_CAPS`: add `schedule_import` per tier — `free: 0, pro: 20, business: 60, enterprise: 150` (mirrors the scan_credential shape; only the Excel AI-detect path consumes it). Keep aligned with `app/paywall.tsx` `AI_LIMITS` if surfaced there.
- No new native modules → **OTA-safe**. `expo.version` unchanged.

### 4.6 `scripts/validate-schedule-import.ts` (new, pure-fn validator → ship-check)
Cases: MSPDI link-type 0→FF / 1→FS / 2→SF / 3→SS; constraint 0–7 → correct `anchorType`; duration parsing (`PT40H0M0S`→5d @ 8h, `"2 wks"`→10d, `"3d"`→3, bare `"4"`→4); calendar-day→working-day offset; WBS rebuild (outline levels → parentId chain, summary flagging); dangling predecessor dropped + warned; milestone detection (0 duration); resource dedupe; empty-title row skipped; source-id → new-id remap keeps links intact.

## 5. Data flow — happy path (Excel)
1. User taps **Import schedule** in Schedule Pro → picks `MyJob.xlsx`.
2. Client reads file → `invoke('import-schedule', { fileBase64, filename })`.
3. Edge fn: detects xlsx → SheetJS → headers `["Activity","Dur","Start","Preds","% Done"]` + rows → Gemini maps `{title:0, durationDays:1, startDate:2, predecessors:3, progress:4}` (conf 0.9) → returns rows + mapping + warnings.
4. Screen shows the mapping (all correct) + preview + "no warnings" → user taps **Import**.
5. `mapRowsToScheduleTasks` → 34 `ScheduleTask`s with FS links + start offsets. `runCpm` → no conflicts.
6. `captureBaseline(current, "Before import — Jul 9")` → replace tasks → `updateProject` → persisted. Schedule Pro shows the imported Gantt.

## 6. MS Project XML (MSPDI) field map
| MSPDI element | MAGE field | Notes |
|---|---|---|
| `Task/UID` | `sourceId` | remapped to a fresh MAGE id |
| `Task/Name` | `title` | |
| `Task/Duration` (+`DurationFormat`) | `durationDays` | ISO-8601 → hours ÷ 8 → working days |
| `Task/Start` | `startDate` → `startDay` | offset from schedule start |
| `Task/PercentComplete` | `progress` | 0–100 |
| `Task/Milestone` (1) | `isMilestone` | |
| `Task/Summary` (1) | `isSummary` | CPM ignores author duration |
| `Task/OutlineLevel`, `Task/WBS` | `outlineLevel`, `wbsCode`, `parentId` | hierarchy rebuild |
| `Task/PredecessorLink` (`PredecessorUID`,`Type`,`LinkLag`,`LagFormat`) | `dependencyLinks[]` | Type 0=FF,1=FS,2=SF,3=SS; LinkLag → `lagDays` |
| `Task/ConstraintType` (0–7), `Task/ConstraintDate` | `anchorType`, `anchorDate` | 0 ASAP,1 ALAP,2 MSO,3 MFO,4 SNET,5 SNLT,6 FNET,7 FNLT |
| `Task/BaselineStart/Finish` (if present) | `baselineStartDay/EndDay` | |
| `Resource/Name` (+`Assignment`) | `resources[]`, `resourceIds`, `crew` | |
| `Project/Calendar` weekdays + exceptions | `workingDaysPerWeek`, `nonWorkingDates[]` | best-effort |

## 7. Error handling
- **Bad/empty file, wrong type, >8 MB** → 400 with a clear message; screen shows it, no crash.
- **AI column-detect fails/timeout** → `mapping: null`; screen falls back to manual dropdowns (all "unset"), preview still works.
- **Unmapped required field (title/start/duration)** at import time → block import with an inline prompt ("Map the Task Name column to continue").
- **Cycles / anchor violations** (from `runCpm`) → non-blocking summary, user may import anyway (CPM already tolerates + flags them in Schedule Pro).
- **Dangling predecessors** → link dropped, `warnings` entry, task still imported.
- **>1,000 rows** → truncate + `truncated:true` warning.
- **Offline** → the edge-fn call needs connectivity; if offline, show "Import needs a connection" (parsing is server-side). The final `updateProject` write still goes through `supabaseWrite` (queued if it drops mid-write).

## 8. Testing
- Pure validator `scripts/validate-schedule-import.ts` (§4.6) wired into `ship-check`.
- `npx tsc --noEmit` clean; `bun run lint` clean.
- Manual: import a real MSP XML export + a messy Excel; confirm Gantt, links, constraints, baseline snapshot, and that the pre-import schedule is recoverable from the baseline manager.
- **Simulator screenshots** of the import screen (mapping step, preview, warnings, post-import Gantt) for the owner's review.

## 9. Open decisions (for owner)
1. **Tier** — Pro+ (recommended) vs Business. Spec assumes Pro+.
2. **Round-trip export to MS Project XML** — build now or defer? (Spec defers.)
3. **Native `.mpp`** — confirmed deferred (needs a server converter).
