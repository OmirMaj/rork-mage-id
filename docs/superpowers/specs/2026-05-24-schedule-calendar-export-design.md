# Schedule — Calendar Jump + Top-Tier Export — Design

**Date:** 2026-05-24
**Status:** Approved (design) — ready for implementation plan
**Scope:** Two enhancements to the **mobile Pro schedule** (`components/schedule/mobile/*`): (1) a month-calendar date picker that jumps the timeline to any date; (2) a best-in-class, fully-populated schedule **export** (a PM-grade PDF report) that is friendly to generate and renders perfectly on every paper size. OTA-safe (no native modules, no migration).

## Goal

Make the mobile schedule navigable to any date in one tap, and give GCs an export that beats every competitor: a dense, professional PM status report (not a bare gantt) that auto-paginates, scales to any paper size, and ships in one tap. Both features build on the just-shipped `selectedDate` + WeekStrip + MobileGantt scroll-to-day work.

---

## Feature 1 — Calendar jump (small)

### Component: `components/schedule/mobile/MonthCalendarSheet.tsx`
A modal bottom-sheet month-grid picker (custom RN views — no native date picker, OTA-safe):
- Month grid (Sun–Sat, 6 weeks), prev/next-month chevrons, a **Today** button, and the picked day highlighted.
- **Activity dots:** days that have a task starting or in progress get a small dot (computed from `tasks` + `startDate`) — a "top tier" touch so the GC sees where the work is.
- `onSelect(date: Date)` → closes the sheet and calls the screen's `setSelectedDate(date)`.

### Wiring: `MobileScheduleScreen.tsx`
- Add a **calendar icon** in the header row (next to the bell) and/or make the WeekStrip month label tappable → opens `MonthCalendarSheet`.
- On select, the existing flow already reacts: `WeekStrip` re-renders to that week and `MobileGantt` scrolls to the day (shipped in `126b87f`). No new gantt wiring needed.

OTA-safe: pure RN/JS.

---

## Feature 2 — Top-tier export

### Architecture overview
Three pure-ish units + one UI sheet, all client-side JS:
1. **`utils/scheduleReportModel.ts`** — assembles a typed data model from the engines (pure).
2. **`utils/scheduleReportHtml.ts`** — renders the model → HTML per paper size + section/options (pure).
3. **expo-print** — turns HTML → PDF and presents the system preview/share (already used by `exportSchedulePdf.ts`).
4. **`components/schedule/mobile/ExportCenterSheet.tsx`** — the friendly mobile export UI.

### 2.1 Report data model — `utils/scheduleReportModel.ts`
`assembleScheduleReport(project, schedule, cpm, opts)` returns a `ScheduleReportModel`:

```ts
interface ScheduleReportModel {
  header: { projectName; location; gc?; pm?; jobNumber?; reportDateIso; dataDateIso; startIso; contractFinishIso?; forecastFinishIso; };
  kpis: { percentComplete; tasksDone; tasksTotal; forecastVarianceDays; spi?: number; svDays?: number;
          criticalCount; minTotalFloat; behindCount; overdueCount; unstaffedCount; };
  criticalPath: { id; title; startIso; finishIso; isMilestone }[];
  risks: { kind: 'overdue'|'zero_float'|'low_float'|'unstaffed'|'behind'|'inspection'; severity:'hi'|'md'|'lo'; text }[];
  lookahead: { weekLabel: string; items: { title; crew?; startIso; finishIso; isMilestone }[] }[]; // 3 weeks
  milestones: { title; dateIso; varianceDays?; onTime: boolean }[];
  ganttRows: { index; title; phase; crew?; startIso; finishIso; baselineFinishIso?; deltaDays?;
               totalFloat; freeFloat; percent; predecessors?: string; isCritical; isSummary; isMilestone;
               bar: { leftPct; widthPct }; baselineBar?: { leftPct; widthPct } }[];
  slippages: { title; deltaDays; reason? }[];        // top N behind baseline
  phaseProgress: { phase; percent }[];
  weatherClosures: { label; note }[];                // rain/holiday/calendar from project calendar
}
```

Sources (all already in the codebase):
- **`runCpm(tasks)`** → `perTask` (`totalFloat`, `freeFloat`, `isCritical`), `projectFinish`, `criticalPath`. Drives float columns, critical-path chain, forecast finish, critical count, min float.
- **Baseline** (`NamedBaseline` via `scheduleOps`) → `baselineFinishIso`, `deltaDays`, slippages. Optional.
- **% complete** per task → phase roll-ups, KPIs.
- **SPI:** prefer `buildEarnedValueSnapshot` (cost-based `spi`) when cost loading exists; otherwise a **duration-weighted schedule-SPI** computed in this module = `Σ(progress·dur) / Σ(plannedProgressAtDataDate·dur)` so the KPI is always available. `svDays` = forecast − contract (or planned − earned in days).
- **Project calendar / closures** → weather & closures section (reuse the calendar-aware CPM data from v2.2b).

Risk detection helper `detectRisks(model parts)`: overdue (not done, finish < data date), zero/low float (≤0 / ≤2), unstaffed (no crew, starts within look-ahead), behind (delta > 0), upcoming inspection (milestone whose title matches /inspect/i within the look-ahead window).

### 2.2 Report HTML renderer — `utils/scheduleReportHtml.ts`
`renderScheduleReportHtml(model, { paperSize, sections, orientation, fitToOnePage })` → HTML string. Extends the proven `exportSchedulePdf.ts` approach (HTML→PDF so text stays crisp/selectable):
- **Per paper size:** `@page { size }` for Letter/A4, Tabloid (11×17), A3 (default), Arch D (24×36), Arch E (36×48); per-size font + bar scale (extend the existing `paperScale`).
- **Auto-pagination:** `page-break-inside: avoid` on every row/card so nothing splits; `thead` repeats per page; long gantts flow to N pages — **never clipped**.
- **Summary-first:** header → KPIs → critical path / risk / look-ahead / milestones land on page 1; gantt follows.
- **Scale-up on big paper:** Arch D/E get larger fonts, thicker bars, finer day-grid (more detail), not a stretched small layout. Arch D/E support a **single-wall-sheet** mode (suppress page breaks).
- **Section toggles:** each block is gated by `sections` so presets/customize include or omit it.
- **`fitToOnePage`:** scale the whole report to one sheet (shrink fonts/bars) for a quick glance.
- **Branding:** MAGE orange header rule + footer, matching the current PDF.
- **Shared helpers:** extract `escapeHtml`, `cssPageSize`, `paperScale`, `addDays` from `exportSchedulePdf.ts` into a shared spot (e.g. keep them in `exportSchedulePdf.ts` and import, or a tiny `utils/scheduleReportShared.ts`) so the two builders don't duplicate.

### 2.3 Auto size — `pickPaperSize(model)`
≤12 tasks → Letter · 13–35 → A3 · 36–80 → Arch D · >80 → Arch E. Surfaced as the **Auto** option.

### 2.4 Mobile Export Center — `components/schedule/mobile/ExportCenterSheet.tsx`
Opened from a new **Export** action in the `MobileScheduleScreen` header. A friendly sheet with:
- **One-tap presets:**
  - **Client Report** — A3, summary + gantt (the email-the-owner deliverable).
  - **Field Gantt** — Arch D, look-ahead band + big gantt (trailer wall).
  - **Full Dossier** — Auto size, all sections + full task register.
  - **CSV** · **Share link** · **iCal** · **AirPrint** (reuse existing generators).
- **Customize:** paper-size selector (Letter/A4 · Tabloid · A3 · Arch D · Arch E · **Auto ✨**), portrait/landscape, **section toggles** (all the sections above + predecessor-IDs column), **fit-to-one-page**.
- **Generate** → `renderScheduleReportHtml` → `expo-print` → iOS system PDF **preview + share/save**.

Reuse existing generators so we don't rebuild them: CSV (`utils/dataExport.ts` / the scheduler's CSV path), **Share link** (`app/shared-schedule.tsx` + its token), **iCal** (`utils/scheduleExportIcal.ts`), **AirPrint** (`expo-print`). The new richer PDF supersedes the gantt-only PDF as the "PDF / report" path; `exportSchedulePdf.ts` is refactored to share helpers (kept for the desktop scheduler's existing button).

### Sections included (per approval: all)
KPIs · critical-path chain · risk & alerts register · 3-week look-ahead · milestones · gantt + baseline overlay (with **Total Float / Free Float / Δ / %**) · biggest slippages · progress by phase · weather & closures. Conditional: SPI/SV (data-date dependent, schedule-SPI fallback) · full task register (Dossier preset) · predecessor-IDs column (toggle).

### Paper-size & fit behavior (per approval)
All sizes + Auto. Auto-paginate (never clip, repeat headers, rows/sections whole) · scale-up on bigger paper · summary on page 1 · fit-to-one-page toggle · Arch D/E single-wall-sheet mode.

---

## Edge cases
- **No baseline** → omit BL columns, slippages, and cost-SPI; show schedule-SPI or "—".
- **No tasks** → Export action disabled / empty state ("Build a schedule first").
- **No crew / no dates** → unstaffed risk flag / em-dashes; bars degrade gracefully.
- **Long schedule** → paginates across pages (or single wall sheet on Arch D/E).
- **No location / PM / job #** → header omits those lines.
- **Web** → reuse the existing print-tab fallback in `exportSchedulePdf.ts` (open HTML in a new tab → print/save).

## Reliability decision — live preview
`react-native-webview` is **not** installed, so an in-app "flip sizes" live preview would require a native build (not OTA). v1 instead: pick options → **Generate → iOS system PDF preview** (expo-print shows the rendered PDF before save/share — no surprises). An in-app WebView preview is a future native-build enhancement.

## OTA-safety
All client JS: an HTML-string builder + `expo-print` / `expo-sharing` / `expo-file-system` (all already installed). The calendar picker is custom RN views. **No native module, no migration.**

## File structure
- **Create:** `components/schedule/mobile/MonthCalendarSheet.tsx` — month-grid date picker.
- **Create:** `components/schedule/mobile/ExportCenterSheet.tsx` — mobile export UI (presets + customize).
- **Create:** `utils/scheduleReportModel.ts` — `assembleScheduleReport`, `detectRisks`, schedule-SPI, `pickPaperSize`.
- **Create:** `utils/scheduleReportHtml.ts` — `renderScheduleReportHtml` (per-size, paginated, section-gated).
- **Modify:** `components/schedule/mobile/MobileScheduleScreen.tsx` — calendar icon + export action; mount both sheets; pass `tasks`/`schedule`/`project`/baseline.
- **Modify:** `utils/exportSchedulePdf.ts` — extract shared helpers (`escapeHtml`, `cssPageSize`, `paperScale`, `addDays`) for reuse; keep the desktop path working.
- **Reuse (no change unless wiring):** `utils/scheduleExportIcal.ts`, `utils/dataExport.ts` (CSV), `app/shared-schedule.tsx` (share link), `utils/cpm.ts`, `utils/scheduleEarnedValue.ts`, `utils/scheduleOps.ts` (baseline).

## Testing & gates
No unit runner (per CLAUDE.md). Per-task gate = `npx tsc --noEmit` clean at the worktree root + grep assertions. Strict TS (no `any`), theme-aware, iOS-primary + web, OTA-safe. Manual walkthrough: open the calendar → jump to a date (timeline scrolls); generate each preset and each paper size → confirm the report is fully populated, paginates without clipping, and scales up on Arch D/E.

## Out of scope (v1)
- In-app WebView **live preview** (needs a native build).
- Planned-vs-actual **S-curve** chart (KPIs already carry SPI/SV; add as an SVG later).
- **Excel/xlsx** export (CSV covers tabular).
- Cross-device sync of export **presets/customizations**.
- A dedicated **procurement/submittal log** section in the report (surface those as risks for now).
