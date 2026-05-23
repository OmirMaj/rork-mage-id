# Summary Dashboard Redesign — "Morning Briefing"

**Date:** 2026-05-22
**Status:** Approved (visual companion, Option A polished — see `.superpowers/brainstorm/40441-1779496231/content/dashboard-A-v2.html`)

## Goal

Turn the **Summary** tab (`app/(tabs)/summary`, the first tab after login) from a stack of cards into a glanceable **login briefing** that is visually distinct from the app's other tile/list pages. Move the cluttering **Tools** list into an overflow menu, and add a real **today + this-week schedule glance** alongside the money snapshot.

## Approved direction

Option **A — "Morning Briefing"** (polished): a warm hero, then soft layered widget cards top-to-bottom — **Today on site → This Week → Money → Needs You** — with Tools tucked behind a **"•••"** header button. Portfolio-wide (rolls up all active jobs). Personal greeting + date so it reads like a daily briefing.

## Current state (what we're replacing)

`app/(tabs)/summary/index.tsx` (621 lines) currently renders, top to bottom:
- `"Summary"` title + `"{N} active projects"`.
- `NextStepHero` (one dynamic action card).
- Portfolio stat row (Budget / Outstanding / Open Punch / At Risk).
- A/R aging strip → `/reports`.
- `CashFlowGlance` (4-week) + `CashFlowAlerts`.
- "Bank-ready reports" CTA → `/reports`.
- **Tools** group: Reports inbox, Cash flow, Pipeline, Buyout, 1099-NEC export → the clutter.
- Per-project `SummaryCard` list.

## New layout (top → bottom)

1. **Briefing hero** — uppercase date line (`FRIDAY · MAY 22`), greeting (`Good morning[, {firstName}]`), and status pills: a danger pill `"{N} need attention"` when there are attention items, and a muted pill `"{N} active"`. A **`•••` overflow button** top-right opens the Tools sheet.
2. **Today on site** — schedule tasks active **today** across all active projects (the mini schedule viewer). Each row: project **color-chip** (2-char initials) + task title + `"{projectName} · {context}"` (context = crew or assigned sub; tasks are day-granular — there is **no time-of-day** field, so the mockup's "10:00 AM" is illustrative only) + a `CRIT` flag when `isCriticalPath`. Meta: `"{N} tasks · {M} jobs"`. Empty state: "Nothing scheduled on site today."
3. **This Week** — a 7-day mini bar chart for the current week (Mon–Sun): bar height ∝ count of tasks active that day across projects; **today highlighted** (accent), weekends muted, **◆ milestone markers** above days that contain a milestone. Meta: `"{N} tasks · {M} ◆ milestones"`. Empty: "No scheduled work this week."
4. **Money** — a tinted 3-stat strip: **Budget** (portfolio total), **Outstanding** (red when > 0), **Cash · 4wk** (from the cash-flow forecast). Tapping Outstanding → `/reports` (A/R aging); tapping Cash → `/cash-flow`.
5. **Needs You** — aggregated attention list across projects: overdue invoices, high-priority open punch items, change orders awaiting approval. Row: severity dot (danger/amber) + label + action link (`Send →` / `View →` / `Review →`) routing to the relevant screen. The whole card is hidden when nothing is pressing.

**Removed from Summary** (folded into the above; no feature lost — access preserved):
- Per-project `SummaryCard` list → per-project detail already lives on the **"Your Projects"** (home) tab; drill-in happens via Today rows + Needs-You actions.
- `NextStepHero` → superseded by **Needs You**.
- A/R aging strip → reachable via Money → Outstanding → `/reports`.
- `CashFlowGlance` / `CashFlowAlerts` → represented by Money → Cash → `/cash-flow`.
- "Bank-ready reports" CTA → relocated into the **Tools sheet** as a "Reports" row so it isn't lost.

**Tools sheet** (`•••`) — a bottom-sheet/modal listing the existing tools as `NavRow`s with their **current routes unchanged**: Reports inbox (`/report-inbox`), Cash flow (`/cash-flow`), Pipeline (`/leads`), Buyout (`/buyout`), 1099-NEC export (`/tax-1099-export`), plus Reports (`/reports`).

## Data sources (all existing — no backend, no new deps)

- `useCoreData()` → `projects`, `isLoading`.
- `useFinancialsData()` → `invoices`, `changeOrders`.
- `useFieldData()` → `punchItems`.
- Per-project schedule: `project.schedule` (`startDate`, `tasks[]`). Task fields used: `startDay`, `durationDays`, `isMilestone`, `isCriticalPath`, `status`, `title`, `crew` / `assignedSubName`. Task date = `startBase + startDay` where `startBase = schedule.startDate ?? project.createdAt`; task end day = `startDay + durationDays`. A task is "active today/this week" when the target day falls within `[startDay, startDay + durationDays]`.
- Budget: `effectiveEstimateTotal(project)` summed over active projects.
- Cash · 4wk: existing `loadCashFlowData()` + `generateForecast(...)` (already used by the current screen), reduced to one figure: the **projected ending cash balance at the end of week 4**. Gated by `isSetupComplete()`; show `—` with a soft hint when not set up.
- Outstanding / overdue / attention: the same logic the current `computeStats` already implements (outstanding = unpaid `totalDue - amountPaid`; overdue = unpaid past `dueDate`; urgent punch = open + `priority === 'high'`; pending COs = `submitted`/`under_review`).
- Greeting name: signed-in user from auth context — first name if present, else email prefix; fall back to plain "Good morning".
- Project color: stable palette assigned by a deterministic index/hash of `project.id` (define `SUMMARY_PROJECT_COLORS` palette of ~6 theme-friendly hues).

## Component breakdown (keep `summary/index.tsx` thin)

- `utils/summaryRollup.ts` — **pure, side-effect-free, unit-testable**:
  - `computeTodayTasks(projects, today): TodayTask[]` → `{ projectId, projectName, projectColor, taskTitle, isCritical, context }`.
  - `computeWeekLoad(projects, weekStart): { days: { date, count, hasMilestone }[7]; totalTasks; milestoneCount }`.
  - `aggregateAttention(projects, invoices, punchItems, changeOrders): AttentionItem[]` → `{ id, severity: 'danger'|'amber', label, actionLabel, route, params? }`.
  - `projectColor(projectId): string` (stable palette pick).
- `components/summary/BriefingHero.tsx` — date line + greeting + status pills + `•••` button (calls `onOpenTools`).
- `components/summary/TodayOnSite.tsx` — Today card (list + empty state).
- `components/summary/WeekAheadStrip.tsx` — 7-day bar chart with today highlight + ◆ markers.
- `components/summary/MoneyStrip.tsx` — 3-stat tinted strip with tap targets.
- `components/summary/NeedsYou.tsx` — attention list (hidden when empty).
- `components/summary/ToolsSheet.tsx` — overflow modal of tool `NavRow`s.
- `app/(tabs)/summary/index.tsx` — compose the widgets; loading skeleton (briefing-shaped); existing "No projects yet" `EmptyState` retained; manage the tools-sheet open state.

## Visual spec (from the approved mockup, mapped to theme tokens)

- Warm screen background: subtle vertical gradient from a warm tint to `bg`/`surfaceAlt`.
- Cards: `surface`, radius `Tokens.radius.xl` (~20), hairline `line` border, soft shadow.
- Section header: tinted rounded icon square (accentSoft / info / success / danger soft) with a `lucide` icon (Sun/CalendarRange, BarChart3, DollarSign, Bell) + uppercase tracked label + right-aligned meta.
- Project chip: 30px rounded square in the project color, white 2-char initials.
- Week bars: `accent` for today, lighter accent for normal days, muted grey for weekends, rounded tops; ◆ uses `accent`.
- Money strip: tinted inset (`surfaceAlt`), 3 columns; Outstanding red when > 0, Cash green.
- Needs You: severity dots `danger`/`accent`; action links in `accentLabel`.
- **Theme-aware**: use `ThemeColors` via `useThemedStyles` — must render correctly in **light and dark**. No raw hex that breaks dark mode; the mockup's hex maps to theme tokens.

## Edge cases

- **Loading** (`isLoading`): skeleton in the briefing shape (hero + 4 widget placeholders).
- **No projects**: keep the existing `EmptyState` ("No projects yet" → Open Projects).
- **All projects closed** (no active): hero shows "0 active"; Today/This-Week show friendly empty states; Needs-You hidden.
- **Project without a schedule**: contributes nothing to Today/This-Week (skipped, no crash).
- **Nothing today**: Today card shows "Nothing scheduled on site today."
- **Needs-You empty**: card hidden entirely (no "0 items" card).
- **Cash flow not set up** (`isSetupComplete` false): Cash shows `—` (no crash); no alert spam.

## Out of scope / constraints

- **No backend, no migration, no edge function, no new dependency** — app + util only, OTA-shippable.
- **Strict TS, no `any`.** Theme-aware (light + dark). iOS primary; web must render.
- Do **not** modify other tabs (`(home)`, `discover`, `settings`, etc.) or the tab layout, beyond the Summary tab and its new components/util.
- All existing tool **routes stay identical** (only relocated into the sheet).
- Reuse existing helpers (`effectiveEstimateTotal`, cash-flow engine, formatters, `NavRow`, `EmptyState`, `Skeleton`).

## Verification

- `npx tsc --noEmit` clean (repo-wide).
- `utils/summaryRollup.ts` functions are pure → add lightweight inline assertions or a small test if a runner exists (repo has no unit runner today; primary gate is tsc + manual walkthrough).
- Manual walkthrough on web (post-deploy) + native preview: loading / no-projects / populated states; Today + This-Week correctness against a known schedule; `•••` opens the Tools sheet and every row routes correctly; Money taps route to reports/cash-flow; render correct in **light and dark** themes.

## Ship

App/util-only and OTA-able. Batch with any other pending work; deploy via the proven paths (web → push `origin/main` → Netlify auto-build; native → `eas update`). Ship is a confirm-gated step.
