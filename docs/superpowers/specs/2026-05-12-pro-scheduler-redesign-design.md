# Pro Scheduler Redesign — Design Spec

**Date:** 2026-05-12
**Owner:** Omir
**Scope:** Tier 2 (Visual refresh + tab framework + Board + Dashboard; Calendar/Workload/Timeline stubbed)
**Target ship:** 2 weeks, OTA-shippable in 2 milestones

---

## 1. Goal

The existing Pro Scheduler (`app/schedule-pro.tsx`, 1,403 lines) is functionally rich — CPM engine, baselines, drag-to-reschedule, AI suggestions, earned value, voice commands, PDF export — but visually doesn't sell the Pro tier. The redesign wraps the working machinery in a polished, multi-view shell that reads as a $79/mo product the first time a user lands on it.

Reference: a Gantt-tool screenshot (provided by user) showing a polished dark-mode multi-tab scheduler with KPI strip, indented WBS grid, color-coded bars, and a "Project Standard · On Track" header.

**Non-goals:**
- Replacing the CPM engine, baselines, AI assistant, or earned-value code (all stay).
- Calendar / Workload / Timeline as real features (stubbed for now — Tier 3 conversation later).
- iPad-first layout (deferred — `ios.supportsTablet` stays `false`).

---

## 2. Locked decisions

These were settled during brainstorming. Each has rationale so a future-me reading this in 2 months knows *why*, not just *what*.

| Decision | Choice | Why |
|---|---|---|
| **Scope tier** | Tier 2 — visual refresh + tab framework + 2 real new tabs (Board, Dashboard) + 3 stubs | Tier 1 ships too thin to justify Pro pricing; Tier 3 burns 4 weeks on Workload/Calendar features that may not move conversion. Tier 2 hits the "feels complete" bar without the long tail. |
| **Color direction** | Industry-mapped trade palette (12 colors), not amber spectrum | All-amber Gantt bars read as one mushy gradient at low zoom — fails the "across the room" legibility test. Industry conventions (blue = electrical, red = roofing) are pre-loaded in PMs' heads. Amber stays anchored on the most common bars (general / sitework). |
| **Reference UX adoption** | Yes — KPI strip, view tabs, indented grid, polished bars, donut %-complete, alternating rows | The reference's structural patterns are battle-tested. Adopting them gets us legibility wins for free. |
| **Critical-path treatment** | Option B — red track underneath (bar sits inside a slightly larger red shell) | Preserves trade color (so phase identity stays), signals criticality unmistakably from any zoom, exports cleanly to PDF. Rejected option A (solid red) because it erases trade information on the tasks that matter most. |
| **Form factor** | Desktop-first | Most GCs schedule from a desk. Phone is for quick checks on site. Phone fallback is single-pane with segmented switcher — known pattern, cheap to build. |
| **Implementation approach** | Refactor into tab shell (option C). Existing `GridPane` and `InteractiveGantt` become tab content components. CPM engine, baselines, AI assistant — untouched. | Preserves 1,400 lines of working scheduler logic. New stuff slots in as focused new files rather than bolting onto a monolith. |

---

## 3. Architecture

### File layout (after refactor)

```
app/
  schedule-pro.tsx                          (rewritten as thin shell — ~150 lines)

components/schedule/
  SchedulerTabShell.tsx                     (NEW — tab nav + content router)
  SchedulerHeader.tsx                       (NEW — KPI strip + status pill + view pickers)
  StatusPill.tsx                            (NEW — "On Track / At Risk / Late" derived from CPM)
  ExportSheet.tsx                           (NEW — unified 5-option export, desktop popover / phone bottom sheet)
  tabs/
    GanttTab.tsx                            (NEW — wraps existing GridPane + InteractiveGantt)
    ListTab.tsx                             (NEW — wraps existing GridPane, full-width)
    BoardTab.tsx                            (NEW — Kanban, 3 status columns)
    DashboardTab.tsx                        (NEW — KPI tiles + charts)
    TabComingSoon.tsx                       (NEW — reusable stub for Calendar/Workload/Timeline)
  GridPane.tsx                              (existing — restyled, no logic change)
  InteractiveGantt.tsx                      (existing — restyled, bar-label scaling added)
  TaskInspector.tsx                         (existing — restyled, trade picker added)
  BaselineManagerModal.tsx                  (existing — untouched)
  AIAssistantPanel.tsx                      (existing — untouched)
  …other modals                             (existing — untouched)

utils/
  scheduleColors.ts                         (NEW — trade → color map, name-inference regex)
  scheduleHealth.ts                         (NEW — derive On-Track / At-Risk / Late from CPM + overdue)
  useBarLabel.ts                            (NEW — width → label-set hook for InteractiveGantt)
  scheduleExportIcal.ts                     (NEW — client-side helper to fetch & open the iCal URL)

supabase/functions/
  schedule-ical/                            (NEW — RFC 5545 calendar feed, signed-token gated)
    index.ts

constants/
  colors.ts                                 (extend with tradeColors.{key} tokens)

types/
  index.ts                                  (extend ScheduleTask with optional tradeKey)
```

### Routing

URL stays `/(tabs)/(home)/schedule-pro?projectId=<id>`. Optional `?tab=<gantt|board|list|dashboard>` query param to deep-link a tab. Tab state persists in local component state (not router-pushed on every click — keeps back-button sane).

### Data flow (unchanged)

```
ProjectProvider → schedule-pro.tsx
                  ↓ reads schedule via useProject(projectId)
                  ↓ runs CPM (existing utility) on every keystroke
                  ↓ passes derived state down to SchedulerTabShell
                  ↓ each tab consumes from a shared context (NEW: SchedulerContext)
```

A small new `SchedulerContext` is added so tab content can pull `tasks`, `cpmResult`, `selectedTaskId`, `setSelectedTaskId` without prop-drilling through 5 levels.

---

## 4. Component specs

### 4.1 SchedulerHeader

**Position:** Sticky at top, full width, below the tab nav.

**Contents (left to right):**
- Project title — 22px serif/sans bold, `text` color.
- Status pill — green "● On Track" / amber "● At Risk" / red "● Late" — derived from `scheduleHealth.computePillStatus(cpm, overdueCount)`.
- KPI strip (one row, 32px gap between groups):
  - Start (date)
  - Finish (date)
  - Duration (`{n} days`)
  - Progress (% + amber donut ring, 32px)
  - Tasks (count)
  - Overdue (count, red if > 0)
  - Completed (count)
- Right-aligned controls:
  - Baseline picker (dropdown of named baselines)
  - View picker (Days / Weeks / Months — controls Gantt scale)

**Behavior:**
- KPIs auto-recompute when CPM rerun fires.
- Donut ring is SVG conic gradient, animates from old → new % on change (200ms ease).
- View picker writes to `schedulerSettings.viewScale` in AsyncStorage (persists across sessions).

### 4.2 SchedulerTabShell

**Tabs (left to right, in order):** Gantt · Board · List · Calendar · Workload · Dashboard · Timeline.

**Active tab:** orange underline (2px, `accent`), text color shifts to `accent`. Inactive: `textSecondary`. Hover: `text`.

**Tab content:** loaded lazily (only the active tab renders). Switching tabs preserves scroll position per tab using a `Map<TabKey, scrollOffset>` in shell state.

**Stub tabs (Calendar, Workload, Timeline):** content is `<TabComingSoon>` with name, mock preview, description, and "Notify me when this ships" button.

### 4.3 GanttTab

Two-pane: GridPane on left (38% width), InteractiveGantt on right (62%). On phone, becomes a segmented switcher (List ⇄ Gantt) within the tab.

**Both panes are existing components, restyled only:**

**GridPane restyle:**
- Alternating row background at 1.5% white tint (`rgba(255,255,255,0.015)`).
- Donut %-complete (18px) in last column. Green for 100%, amber-partial for in-progress, empty gray-bordered for 0%.
- Monospace duration column (`ui-monospace`).
- WBS indent: 14px per level. Summary rows = bold name + chevron, no donut.
- Row hover: background lifts to `surfaceAlt`.
- Click row → opens TaskInspector side panel (existing behavior, restyled panel).

**InteractiveGantt restyle:**
- Bar colors driven by `scheduleColors.colorForTask(task)` (see §5).
- Inner progress fill: white at 22% opacity, width = `task.progress`%.
- Bar labels: `useBarLabel(widthPx, task)` returns full / medium / ID-only / empty per §5.5.
- Critical-path bars: red track underneath (see §5.3). Dependency arrows ENTERING a CP bar render in red, creating one visual chain.
- Day-number axis row above the bar area (every 7th day labeled).
- Weekend column shading: Saturday + Sunday tinted at 2.2% white.
- Vertical week-grid lines (subtle 1px columns) so bars feel anchored to a real timeline.
- Today line: 1.5px dashed `#FF5A51`, full Gantt-pane height, with anchored "TODAY · MMM D" red pill at top.
- Milestones: 14px amber-light diamond (start/intermediate) or 14px red diamond (project completion).
- Baseline ghost bars: 4px gray strip below each main bar showing original planned dates (only renders when current ≠ baseline).
- Resource avatars: 18px circle at right end of bar with crew initial.
- Dependency arrows: 1px solid `stone` color (or `#FF5A51` 1.5px for CP→CP), right-angle path, small filled triangle arrowhead. Hover-dims everything else.
- Hover tooltip on every bar regardless of size: task name, dates, duration, %, predecessors, successors, crew, optional "X days late".
- Drag-to-reschedule (existing) preserved.

### 4.4 ListTab

Same `GridPane` as the left half of GanttTab, but rendered full-width. No Gantt pane. Used when the user wants a denser table view (more columns visible at once).

Adds columns: Float (days), Start day index, Resource(s), Phase tag.

### 4.5 BoardTab (NEW)

**Layout:** 3 columns, equal width, scrollable independently.

**Columns:** "Not Started" · "In Progress" · "Done" — exactly matches existing `status` enum on `ScheduleTask`. (Future "Blocked" column = Tier 3 conversation, not now.)

**Column header:** uppercase name + count chip (right-aligned, `textSecondary`).

**Card content:**
- Top row: phase dot (7px circle, trade color) + phase label (uppercase, 9px).
- Task name (12px, 1–2 lines, line-clamp).
- Bottom row: donut %-complete (14px) + due date / days remaining + optional red "CP" badge for critical-path tasks.

**Interactions:**
- Drag card between columns → updates `task.status` via `updateScheduleTask` (existing mutation).
- Click card → opens TaskInspector (same as GanttTab).
- Filter chip at top right: "All phases ▾" — narrows to one trade.

**Empty column:** subtle "Drag a card here" placeholder.

### 4.6 DashboardTab (NEW)

**Layout:** 3 stacked rows.

**Row 1 — KPI tiles** (4 cards, grid):
- Health Score — uses existing `schedule.healthScore`. Color shifts: green ≥ 80, amber 60-79, red < 60. Delta arrow vs baseline if a baseline exists.
- Critical Path days — from CPM `criticalPathDays`. Delta vs baseline ("↘ +2 days slip").
- Cost Performance Index — from existing earned-value calc (if EV data present; otherwise "—").
- Overdue count — red if > 0, with the offending task name as subtitle.

**Row 2 — Two charts side-by-side:**
- **Earned Value triple-line chart** (1.4fr width): PV (planned, dashed gray), EV (earned, solid amber), AC (actual cost, solid red). X-axis = project weeks. Legend top-right.
- **Tasks by Status donut** (1fr width): 4-segment donut (Done = amber, In Progress = amber-light, Not Started = neutral gray, Overdue = red). Legend with counts.

**Row 3 — Critical Path activities list:**
- Boxed card. Header: "Critical Path Activities · {n} tasks · {totalDays}d".
- Each row: red dot + task name + float (e.g., "0d float", red monospace) + due date.

**Data sources (all derive from existing state — no schema changes):**
- Health → `schedule.healthScore`.
- CP days → CPM result.
- CPI → existing EV calculator.
- Task counts → derived from `tasks[].status`.
- CP activities → `tasks.filter(t => t.isCriticalPath)`.

### 4.7 TabComingSoon

Reusable stub. Props: `{ tabName, tagline, mockPreview, eventKey }`.

**Body:**
- Top: tab name + small "soon" pill in amber.
- Mock preview (~80–120px tall) — semi-real rendering of what the tab will look like (month grid for Calendar, resource heatmap for Workload, slim Gantt for Timeline).
- Tagline (1–2 sentences).
- "Notify me when this ships" button → writes to `feature_interest` table (NEW — migration added in Week 2) with `{ id, user_id, event_key, created_at }`. Single-row uniqueness on `(user_id, event_key)`. RLS: insert/select own rows only.

---

## 5. Visual design

### 5.1 Trade color palette (12 colors)

Added to `constants/colors.ts` as `Colors.tradeColors`:

| Trade key | Color (hex) | Notes |
|---|---|---|
| `general` | `#FF6A1A` | Brand amber — default, sitework, mobilization, anything uncategorized |
| `concrete` | `#90A4AE` | Slate gray |
| `framing` | `#8D6E63` | Wood brown |
| `electrical` | `#4FC3F7` | Sky blue |
| `plumbing` | `#26C6DA` | Teal |
| `hvac` | `#FFA726` | Warm orange (distinct from amber brand) |
| `roofing` | `#EF5350` | Red |
| `steel` | `#AB47BC` | Purple |
| `demo` | `#FBC02D` | Caution yellow |
| `landscaping` | `#66BB6A` | Green |
| `finish` | `#F4EFE6` | Cream (drywall, paint, trim) |
| `closeout` | `#7986CB` | Soft indigo (inspections, punchlist) |

All colors saturation-matched for dark-mode contrast against `surface` `#14181D`. Tested for WCAG AA against white inner-fill text.

### 5.2 Trade inference

When a task has no explicit `tradeKey`, `scheduleColors.inferTradeFromName(task.name)` runs a regex against the name (case-insensitive). First match wins:

```
/concrete|foundation|footing|slab|pour/  → concrete
/frame|framing|stud|joist|beam/          → framing
/electric|wiring|conduit|panel|outlet/   → electrical
/plumb|pipe|drain|water line/            → plumbing
/hvac|duct|heating|cooling|ventil/       → hvac
/roof|gutter|flashing|shingle/           → roofing
/steel|weld|metal stud|rebar/            → steel
/demo|demolition|excavat|grade site/     → demo
/landscap|sod|plant|irrigat|hardscap/    → landscaping
/drywall|paint|trim|finish|tile|floor/   → finish
/punch|inspect|closeout|substantial/     → closeout
(default)                                → general
```

User can override per-task in TaskInspector via a trade picker dropdown. Override stored on `task.tradeKey`.

### 5.3 Bar states

| State | Visual |
|---|---|
| Default | Trade-colored rectangle, 20px height, 5px corner radius, subtle drop shadow (`0 1px 3px rgba(0,0,0,0.3)`). Inner fill = white at 22% opacity, width = `task.progress`%. |
| Critical path | Trade-colored bar sits inside a slightly larger red "shell": 26px outer height, `#FF5A51`, 7px corner radius, soft red halo (`0 0 8px rgba(255,90,81,0.4)`). Inner bar = 20px, 3px inset, original trade color. Red appears above + below + at both ends. Dependency arrows ENTERING a critical-path bar also draw in red — the CP chain reads as one continuous visual thread. |
| Milestone (start / intermediate) | 14px amber-light (`#FFCC80`) square rotated 45°. No bar (durationDays = 0). Soft amber glow. |
| Milestone (project completion) | 14px red (`#FF5A51`) square rotated 45°. Soft red glow. Distinguishes the final "Substantial Completion" event from start milestones. |
| Overdue | Bar opacity drops to 40%. Inner progress fill switches to red (`#FF5A51`). Subtle pulse animation (1.5s opacity 0.6 ↔ 1.0, infinite). Optional "● late" pill at bar's right end (collapses on small Gantt scales). |
| Today line | 1.5px dashed `#FF5A51`, full Gantt-pane height, z-index above bars / below tooltips. Auto-scrolls to center on screen open. Anchored "TODAY · MMM D" pill at the top so the line is labeled, not just decoration. |
| Dependency arrow | 1px solid `stone` (`#4A5159`), right-angle path with 5px filled triangle arrowhead. CP-→CP links draw at 1.5px solid `#FF5A51`. Hover any bar dims everything else to 30% opacity to highlight that bar's predecessor/successor chain. |
| Baseline ghost | Thin 4px gray bar (`rgba(154,163,173,0.25)`) directly below each main bar, spanning the original baseline dates. Only renders when a baseline exists. Invisible when current dates match baseline (saves vertical noise). |
| Resource avatar | 18px circle at the right end of the bar, `surface` background, 1.5px `stone` border, single-letter crew initial in `text` color. Tap → opens crew filter ("show only Mike's tasks"). |
| Weekend column | Saturday + Sunday columns rendered with 2.2% white tint background to dim non-working days. Holidays from `schedule.nonWorkingDates` get the same treatment plus a small dot in the day-axis row. |

### 5.5 Bar label scaling

Bar inner labels auto-degrade as the bar gets narrower. A small `useBarLabel(widthPx, task)` hook returns the appropriate label set:

| Bar width | Inside the bar | Outside / on hover |
|---|---|---|
| ≥ 110px (wide) | `T{id} {name}` + `{progress}%` right-aligned | — |
| 70–109px (medium) | `T{id} {name}` (no %) | % only on hover tooltip |
| 40–69px (narrow) | `T{id}` only, centered | Full name floats to the right of the bar in `textMuted` 60% opacity |
| < 40px (tiny) | empty | Name + dates + duration + % all on hover tooltip |

All bars regardless of size show a tooltip on hover containing: task name, start date, finish date, duration, %-complete, predecessors, successors, assigned crew, and (if applicable) a "X days late" line in red. Tooltip styled as `surface` card with 1px `cardBorder`, 6px radius, drop shadow.

### 5.4 Tokens added to `Colors`

```ts
// constants/colors.ts (additions)
export const Colors = {
  // ...existing...

  // Trade colors — used by Gantt + Board phase-dots
  tradeColors: {
    general:      '#FF6A1A',
    concrete:     '#90A4AE',
    framing:      '#8D6E63',
    electrical:   '#4FC3F7',
    plumbing:     '#26C6DA',
    hvac:         '#FFA726',
    roofing:      '#EF5350',
    steel:        '#AB47BC',
    demo:         '#FBC02D',
    landscaping:  '#66BB6A',
    finish:       '#F4EFE6',
    closeout:     '#7986CB',
  },

  // Status pill colors (derived from existing success/warning/danger)
  pillOnTrack:  '#4ED37A',  // = success
  pillAtRisk:   '#FFA726',  // = warning warm
  pillLate:     '#FF5A51',  // = danger
};
```

---

## 6. Data model changes

### 6.1 `ScheduleTask` extension (non-breaking)

```ts
// types/index.ts
interface ScheduleTask {
  // ...existing fields...

  /** Trade taxonomy key — drives Gantt bar color + Board phase dot.
   *  When unset, inferred from task.name via scheduleColors.inferTradeFromName().
   *  See utils/scheduleColors.ts for the canonical key list. */
  tradeKey?: TradeKey;
}

type TradeKey =
  | 'general' | 'concrete' | 'framing' | 'electrical' | 'plumbing'
  | 'hvac'    | 'roofing'  | 'steel'   | 'demo'       | 'landscaping'
  | 'finish'  | 'closeout';
```

### 6.2 Migration

**For `tradeKey` on ScheduleTask:** none required. The field is optional. Week 1 ships with pure name-inference (no schema dependency). Week 2 adds the `tradeKey?` field + TaskInspector trade-picker; existing tasks without `tradeKey` continue to fall through to inference at render time. When a user picks a trade in the inspector, the field gets persisted on save.

**For `feature_interest` table (NEW, Week 2):**

```sql
create table public.feature_interest (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  event_key   text not null,                 -- e.g. 'scheduler_calendar_tab', 'scheduler_workload_tab'
  created_at  timestamptz default now(),
  unique (user_id, event_key)
);
alter table public.feature_interest enable row level security;
create policy "users insert/select own interest" on public.feature_interest
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### 6.3 Status pill logic

`utils/scheduleHealth.ts` exports:

```ts
type PillStatus = 'on_track' | 'at_risk' | 'late';

function computePillStatus(opts: {
  cpmSlipDays: number;        // baseline → current critical-path delta
  overdueCount: number;
  healthScore: number;        // existing 0-100 score
}): PillStatus;
```

Rules:
- `overdueCount > 0` OR `cpmSlipDays > 7` → **late**
- `cpmSlipDays > 2` OR `healthScore < 70` → **at_risk**
- otherwise → **on_track**

Thresholds chosen to feel honest, not gameable. Tunable post-launch based on user feedback.

---

## 7. Responsive behavior

### 7.1 Desktop / web / iPad-landscape (≥ 900px wide)

Full reference layout as specified. Two-pane Gantt (Grid + Gantt side by side). KPI strip horizontal. Tab nav horizontal at top.

### 7.2 Phone (< 600px wide)

**Nav header:**
- Back button "‹ Project" left, **"⤓ Export"** + overflow `⋯` right — both in `accent` color, iOS-tap-target sized.
- Project title (17px bold) + 2-line subtitle: status pill + finish date + slip days.

**KPI chip rail:**
- Horizontal-scroll, snap-to-chip. Each chip is 74px wide minimum: 8px label / 13px value / 7px delta line.
- 5 chips on first load: Progress · Duration · Done · Overdue · Crit Path. Swipe to see more if user has extras configured.

**Gantt tab body:**
- **No segmented control.** The phone shows ONE view per tab — for the Gantt tab, that's the Gantt. (Rationale: on a phone, a "List view" vs "Gantt view" toggle adds friction without value — task names already left-pin in the Gantt view, so the user already has both.)
- Body is a horizontally-scrollable Gantt. Width grows beyond the screen; user swipes left/right to see later dates.
- Task-name column (90px) is **sticky-left** with a soft gradient fade, so the user always knows which row they're scrolling.
- Month axis header is **sticky-top**, so scrolling tasks vertically keeps the date scale visible.
- First-load floating hint pill ("⇄ Scroll for full schedule") appears bottom-right of the Gantt area for 3 seconds OR until the first horizontal scroll, whichever is sooner. Stored in AsyncStorage `scheduler_phone_scroll_hint_dismissed` so it never reappears for the same user.
- Bar labels follow the §5.5 sizing rules. Bars are 12px tall on phone (vs 20px desktop) to fit more rows in view.
- Pinch-zoom horizontally adjusts the time scale (Days ↔ Weeks ↔ Months).
- Long-press a bar → opens TaskInspector as a bottom sheet (90% screen height).

**Tabs:**
- Tab nav moves to **bottom** (iOS convention). Only 4 visible: Gantt · Board · Dash · More.
- "More" opens a sheet listing the remaining tabs: List, Calendar, Workload, Timeline.
- Active tab amber `accent`; inactive `textMuted`.

**Floating "+" FAB:**
- 44px amber circle, bottom-right within thumb reach. Opens new-task bottom sheet.

**Board tab on phone:**
- Cards stack in single column with a tab-strip switcher for status columns (Not Started / In Progress / Done). Swipe horizontally between columns.

**Dashboard tab on phone:**
- KPI tiles wrap to 2 cols × 2 rows. Charts stack vertically. Critical path list scrolls full-width.

### 7.4 Export (NEW — replaces older PDF-only export)

A unified Export action sheet — accessible from the desktop "⊕ Share" button and the phone "⤓ Export" button. Same five options on both surfaces:

| Option | Output | Backend |
|---|---|---|
| **PDF · Full Gantt** | Multi-page PDF, baseline overlay, color legend, project KPIs in cover page. | Existing PDF generator (`utils/scheduleExportPdf.ts`) — already shipped. |
| **CSV · Task list** | One row per task: id, name, trade, start, finish, duration, progress, predecessors, crew, float, status. | Existing CSV generator — already shipped. |
| **Share link · Read-only** | Base64-encoded URL the recipient opens in browser (no login required). | Existing `/shared-schedule` route — already shipped. |
| **iCal · Calendar feed** *(NEW)* | `.ics` file the user subscribes to in Apple/Google Calendar; auto-updates when schedule changes. | NEW edge function `schedule-ical/index.ts` returns `text/calendar`, RFC 5545 VEVENT per task. URL contains a signed token (HMAC of `schedule_id + user_id`) for access control. |
| **Print / AirPrint** | Routes the PDF through iOS share sheet → AirPrint. | Phone-only. Calls the existing PDF generator, then `Print.printAsync(uri)` from `expo-print`. |

**iCal implementation notes:**
- New edge function: `supabase/functions/schedule-ical/index.ts`. `verify_jwt: false`; access is gated by the signed token in the URL.
- Token shape: `base64url(hmac_sha256(SCHEDULE_ICAL_SECRET, scheduleId + userId)).slice(0, 16)`.
- ICS body: one VEVENT per non-milestone task with non-zero duration, DTSTART/DTEND, SUMMARY = task name, DESCRIPTION = trade + crew + %-complete, UID = `<scheduleId>-<taskId>@mageid.app`. Milestones get VEVENT with DTSTART=DTEND.
- Client-side: a single `<ExportSheet>` component renders the same 5-option list on both desktop and phone — on desktop it appears as a popover under the "⊕ Share" button; on phone it's a bottom sheet.

### 7.3 Tablet (600–899px wide)

Compressed desktop layout. Two panes still side-by-side but Grid pane shrinks to 30%. KPI strip wraps to 2 rows if needed. Tab nav stays horizontal at top.

---

## 8. Phasing — what ships when

### Week 1 — Visual refresh of existing tabs (OTA-shippable)

- New `SchedulerTabShell` wrapper with 7 tabs (Gantt active, others temporarily disabled placeholders).
- New `SchedulerHeader` with KPI strip + status pill + view pickers.
- `StatusPill` component + `scheduleHealth.computePillStatus()` utility.
- Restyle `GridPane`: donut %-complete, alternating rows, monospace duration, WBS indent improvements.
- Restyle `InteractiveGantt`: trade-color bars, inner progress fills, red-track critical path, dashed today-line, milestone diamonds, dim dependency arrows.
- Add `Colors.tradeColors.*` tokens.
- Add `utils/scheduleColors.ts` with the trade-color map + name-inference regex.
- Wire `useTheme()` into all new components — no static colors.

**Result:** screen looks like the reference. Old functionality preserved. New tabs visible but inactive.

### Week 2 — New tabs + phone polish + unified export (OTA-shippable)

- `BoardTab` — Kanban with 3 status columns, drag mutations, CP badges, phase filter.
- `DashboardTab` — KPI tiles, earned-value chart, status donut, critical path list.
- `TabComingSoon` reusable component + Calendar/Workload/Timeline stubs.
- Migration: create `feature_interest` table (see §6.2).
- Wire "Notify me" buttons to `feature_interest` table.
- Phone fallback: horizontally-scrollable Gantt with sticky task-name column + sticky month axis, chip-rail KPIs, scroll-hint pill, bottom-sheet TaskInspector, overflow tab for 7→4 nav compression. **No segmented control** — phone shows the Gantt directly.
- Add `tradeKey?` field to `ScheduleTask` type + TaskInspector trade picker.
- `<ExportSheet>` component — unified 5-option export sheet (PDF · CSV · Share link · iCal · AirPrint). Desktop popover, phone bottom sheet.
- NEW edge function `schedule-ical/index.ts` (signed-token RFC 5545 feed).
- Phone Print/AirPrint wired via `expo-print`.

**Result:** Tier 2 complete. Marketing site can use a Pro Scheduler screenshot as the Pro plan's primary value-prop. Users can hand a fresh PDF to the owner, a CSV to the bookkeeper, or an iCal feed to a sub — all from one button.

---

## 9. Testing

### Manual (per milestone)

- [ ] Open existing project in scheduler — Gantt renders, no crashes.
- [ ] Drag a bar — date updates, CPM reruns.
- [ ] Add a critical-path task — red track visible.
- [ ] Toggle theme to light — all colors derived correctly (donut, bars, pill).
- [ ] Phone build — KPI rail scrolls, segmented switcher works, bottom sheet opens.
- [ ] Status pill — change project so CP slips by 8 days, verify "Late".
- [ ] Trade override in TaskInspector — bar color updates without page reload.
- [ ] Board drag — task moves columns, `status` updates in DB.
- [ ] Dashboard — KPI numbers match what's in the header strip.
- [ ] PDF export — bars/colors render correctly (no glow clipping).

### Automated

Existing CPM unit tests must continue to pass — they exercise the engine which is untouched. No new automated tests required for visual changes (manual QA per checklist above).

---

## 10. Out of scope (Tier 3 conversation later)

- Real Calendar tab (month grid, drag-to-reschedule from date cells).
- Real Workload tab (resource-by-day heatmap, overallocation flags). Needs per-day labor-hour data not in the current model.
- Real Timeline tab (slim Gantt, no grid, for stakeholder share).
- Custom user-defined trade colors (Settings → Trade Colors editor).
- New status columns on Board (Blocked, Review).
- Bulk-edit operations on Board (multi-select drag).
- Dashboard customization (drag tiles, hide/show).
- iPad-first layout (would require flipping `ios.supportsTablet`).
- Light-mode-only audit of trade colors (currently designed for dark; light-mode renders are not tested for the trade palette — punt to feedback).

---

## 11. Open questions

None at this stage. All visual decisions, scope, color palette, critical-path treatment, form factor, and phasing are locked.

---

## 12. Success criteria

- A first-time user lands on `/schedule-pro` and reads it as a polished, professional-grade construction-management product worth $79/mo.
- The bar coloring is legible from across a desk without a legend.
- Existing power-user features (drag-to-reschedule, AI suggestions, baselines) still work identically.
- Phone users can still get useful schedule info without horizontal scrolling through a Gantt.
- Marketing can use a screenshot of this view as the Pro plan's primary hero image.
