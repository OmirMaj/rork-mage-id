# Pro Scheduler — Phase 1: Front Door + Coherent Shell (Design)

**Date:** 2026-07-10
**Status:** Approved — ready for implementation plan
**Surface:** Web / desktop Pro scheduler (`app/schedule-pro.tsx`). Phone is a separate track.
**Scope discipline:** Presentation & information-architecture only. The CPM engine (`utils/cpm.ts`), offline queue, persistence, and data model are **not** touched.

---

## Why

An audit of the Pro Scheduler (6 parallel passes over the real code + a Microsoft Project teardown, 2026-07-10) reached a blunt conclusion: MAGE's scheduler has a **deeper engine than most competitors** but **every surface hides it, and there is no front door**. The user's ask — "make it easier for humans to use, it's not as good as Microsoft Project" — is dominated by information-architecture and plain-language problems, not missing features.

Concretely, the desktop scheduler stacks **three separate control bars** above the first task:

1. **`schedule-pro.tsx` custom header** (`app/schedule-pro.tsx:1372-1440`) — Back, project title, a 5-button pane toggle (Grid/Split/Gantt/Lanes/Living, lines 1388-1408), and a **17-button** flat action row (lines 1414-1438).
2. **`SchedulerTabShell` tab strip** (`components/schedule/SchedulerTabShell.tsx:45-52`) — 6 tabs (Gantt/Board/List/Calendar/Workload/Dashboard).
3. **`SchedulerHeader`** (`components/schedule/SchedulerHeader.tsx:110-153`) — the project title **again**, 7 KPIs, two pickers, and **duplicate** Add-Task + Export buttons.

Additional confirmed problems:
- **No empty state.** The only early returns are "no project" (`schedule-pro.tsx:1319`) and "screen too narrow" (`:1334`). A project with **zero tasks** renders the full cockpit over a blank grid. There is no on-ramp; the three creation flows (`schedule-wizard`, `QuickBuildModal`, AI `generative-setup`) are scattered and unlinked from Schedule Pro.
- **Dual view-switchers fight.** The pane toggle and the tab strip both contain "Gantt," requiring a `paneModeNonce` hack (`SchedulerTabShell.tsx:114-118`, `schedule-pro.tsx` `setPaneModeAndForceGantt`) to force the tab back to Gantt when a pane button is pressed.
- **Jargon-first.** `DashboardTab` leads with `COST PERF. (CPI) —` (`DashboardTab.tsx:67-72`) and `0d float` (`:144`); the header KPI rail shows raw `Crit Path` (`SchedulerHeader.tsx:104`). No plain-language scaffolding.
- **A fake chart that reads as broken.** The Earned-Value chart draws **hardcoded sample polylines** with the caption "Sample shape · link a budget to populate" (`DashboardTab.tsx:94-102`).
- **A developer `Demo` button ships in production** next to Share/PDF (`schedule-pro.tsx:1423`), and can overwrite a real schedule.

## Goal

A first-timer sees an obvious way to start. A returning user sees **one** clean, plain-language shell instead of a 40-control cockpit. Nothing about the underlying schedule math changes.

## Non-goals (deferred to later phases)

- **Phase 2 — Fluent grid:** inline ghost row, Enter-down, paste-creates-rows, insert-anywhere, drag-reorder, fast inline dependencies.
- **Phase 3 — Surface the power:** a "Fix overloads" button on the already-built leveling engine, an explained critical-path panel that shows float as "can slip X days," an audit-log viewer.
- **Separate track:** mobile/phone scheduler redesign (Today landing, touch-first Gantt).

These are out of scope here and must not be started as part of Phase 1.

---

## The four moves

### Move 1 — The Front Door (first-run on-ramp)

**New component:** `components/schedule/ScheduleOnRamp.tsx`.

**Trigger:** in `schedule-pro.tsx` main render, add a branch *before* the cockpit render when `project` exists, `width >= GRID_BREAKPOINT`, **and** `workingTasks.length === 0`. Render `<ScheduleOnRamp />` inside the normal container (keep the custom Back header minimal — Back + title only, no toolbar/pane toggle).

**Content:** a centered card, headline "Let's build your schedule," with three call-to-action buttons and one secondary link:

1. **Build it from my estimate (AI)** — primary, amber-highlighted. Routes to the generative AI flow (the approved "hero" — same destination the `project-detail` generative tile uses, `generative-setup`). If the project has no linked estimate, the flow still opens and explains what it needs (handled by the existing generative screen; the on-ramp only navigates).
2. **Start from a template** — routes to `app/schedule-wizard.tsx` (the existing 4-step wizard).
3. **Add tasks manually** — dismisses the on-ramp (sets a local `dismissedOnRamp` state so the cockpit shows even with 0 tasks) and opens the existing Add-Task modal for the first task.
4. **Load an example schedule** — secondary text link; calls the existing `handleLoadDemo`. This is the **only** place "Demo" is exposed to users now.

**Result:** one obvious front door; the three creation flows are unified behind it; the cockpit is never shown over an empty grid unless the user explicitly chooses "Add tasks manually."

### Move 2 — One view-switcher

Collapse the 5-button pane toggle **into** the Timeline tab as a compact layout menu, leaving a single flat tab set.

- **`SchedulerTabShell.tsx`:** rename the tab keys `dashboard → overview` and `gantt → timeline` and reorder `TABS` to: `Overview · Timeline · List · Board · Workload · Calendar (soon)`. This is a mechanical rename — update every reference in the file: the `SchedulerTabKey` union type (`:34-40`), the `TABS` array (`:45-52`), the `renderTab` switch (`:257-328`), the default `useState` (`:107`), and the phone `PhoneTabBar` `VISIBLE`/`OVERFLOW` lists (`:186-191`). The phone path keeps working unchanged (no phone redesign in Phase 1). Remove the `paneModeNonce` effect (`:114-118`) — it is no longer needed because the pane control moves inside the tab it controls.
- **`GanttTab.tsx`:** render the layout switcher (`Grid · Split · Gantt · Lanes · Living Plan`) as a small segmented control / `▾` menu at the top of the Timeline tab, driven by its own local `paneMode` state (seeded from the prop for back-compat). The `ganttPaneMode` / `paneModeNonce` props and `setPaneModeAndForceGantt` in `schedule-pro.tsx` are removed.
- **Default tab:** `Overview` (Move 4), replacing the current `useState('gantt')` default (`SchedulerTabShell.tsx:107`).

**Result:** one mental model. No two controls named "Gantt." The `paneModeNonce` hack is deleted.

### Move 3 — Group the toolbar & de-dupe the headers

**`schedule-pro.tsx` toolbar (`:1414-1438`)** becomes a small primary cluster plus a grouped overflow:

- **Primary inline:** `✦ AI` (highlighted), `＋ Add Task`, `↶ ↷` (Undo/Redo pair), `⤓ Export/Share`, the `Health` badge (unchanged component), and `More ▾`.
- **`More ▾` overflow** (a menu/sheet), grouped by intent:
  - *Analyze:* Critical path (replaces the raw `CPM` `Alert`, still an alert in Phase 1 — the explained panel is Phase 3), Reflow, Weather, Closures, Baseline.
  - *Import:* Import.
  - *Settings.*
- **Export consolidation:** the individual `CSV`, `iCal`, `PDF` toolbar buttons and the separate `Share` button collapse into one `Export/Share` entry that opens the existing `ExportSheet` (which already offers those formats). The duplicate `Export` in `SchedulerHeader` (`:149`) is removed.
- **Demo:** removed from the toolbar; only reachable via the on-ramp "Load an example" link (or `__DEV__`).
- **Header de-dupe (committed decision):** the `schedule-pro` custom header is the **single identity + actions row** (Back, title, status pill, the primary action cluster). `SchedulerHeader` is reduced to the **verdict/KPI rail + BASELINE/VIEW pickers only** — its duplicate title row (`:113`), its `＋ Add Task` button (`:144-148`, drop the `onAddTaskPress` prop), and its `Export` button (`:149`) are all removed. Net: title, Add Task, and Export each render exactly once.

**Result:** ~5 primary controls instead of 17; the rest grouped by purpose; title and Add/Export appear exactly once.

### Move 4 — Plain-language Overview (new default landing)

**New pure module:** `utils/scheduleVerdict.ts` + `scripts/validate-schedule-verdict.ts` (matches the repo's no-jest validator pattern, wired into `ship-check`).

```ts
export type VerdictTone = 'onPace' | 'ahead' | 'slightlyBehind' | 'behind' | 'noBaseline';

export interface ScheduleVerdict {
  tone: VerdictTone;
  headline: string;   // e.g. "On pace — finishing about Aug 14"
  detail: string;     // e.g. "Electrical rough-in is your finish-date driver. 2 tasks overdue."
}

export interface VerdictInput {
  slipDaysVsBaseline: number | null;  // null = no baseline set
  finishDateLabel: string;            // preformatted, e.g. "Aug 14, 2026" or "—"
  criticalDriverTitle?: string;       // name of the finish-date-driving critical task, if any
  overdueCount: number;
}

export function scheduleVerdict(input: VerdictInput): ScheduleVerdict;
```

Tone thresholds (buildable, testable): `slip == null → noBaseline`; `slip <= -1 → ahead`; `slip === 0 → onPace`; `1..3 → slightlyBehind`; `>= 4 → behind`. Headlines/details are plain English; the driver clause and the overdue clause append only when non-empty.

**`DashboardTab.tsx` → Overview:**
- Lead with a **verdict banner** at the top (colored dot + `headline`, then `detail`), from `scheduleVerdict(...)`.
- Reframe the stat tiles into plain language; keep HEALTH SCORE and OVERDUE, replace `CRITICAL PATH` value-only with "Finish-date driver" framing, and **replace the `COST PERF. (CPI) —` tile** with an honest "Budget — link an estimate to track" tile (or drop it) rather than a dead "—".
- **Delete the fake EV chart.** Render the real EV chart only when `evSnapshot.totalBudget > 0`; otherwise an honest empty state ("Link a budget to see earned value"). No hardcoded sample polylines.
- Move SPI/CPI/EVM/float behind an **"Advanced metrics"** disclosure (collapsed by default).

**`SchedulerHeader.tsx`:** lead the KPI rail with a **compact** verdict — the tone dot + finish date only (e.g. "● finishing ~Aug 14"), since `SchedulerHeader` shows on every tab. The **full** verdict banner (headline + `detail` sentence) lives only in the Overview tab, so the two never show the same sentence twice. Keep START/DURATION/TASKS/etc. but visually demoted; relabel `Crit Path` to "Finish driver" with a tap-for-detail tooltip. Acronyms never lead.

**Plain-language mapping (applied across Overview + header):**

| Jargon (today) | Plain language (Phase 1) |
|---|---|
| Critical path | "Finish-date driver" — the tasks that set your finish date |
| `0d float` | "no buffer" (float itself = "can slip X days," fully surfaced in Phase 3) |
| Slip / `+3d slip` | "3 days behind the original plan" |
| Baseline | "Original plan" (a saved snapshot) |
| Reflow | "Re-plan around actual progress" |
| SPI / CPI / EVM | kept as-is but behind "Advanced metrics" |

---

## File map

**New**
- `components/schedule/ScheduleOnRamp.tsx` — the front-door card (Move 1). Pure presentation + navigation callbacks passed in from `schedule-pro`.
- `utils/scheduleVerdict.ts` — pure verdict function (Move 4). No React, no I/O.
- `scripts/validate-schedule-verdict.ts` — validator for the above; add to the `ship-check` chain in `package.json`.

**Modified**
- `app/schedule-pro.tsx` — on-ramp branch; regroup toolbar into primary + `More`; remove pane toggle + `setPaneModeAndForceGantt` + `paneModeNonce`; consolidate export; drop Demo from toolbar; single identity header.
- `components/schedule/SchedulerTabShell.tsx` — reorder/relabel `TABS`; default to `overview`; remove `paneModeNonce` effect and the related pass-through props.
- `components/schedule/tabs/GanttTab.tsx` — own the layout switcher (Grid/Split/Gantt/Lanes/Living) as a local segmented control.
- `components/schedule/tabs/DashboardTab.tsx` — reframe as Overview: verdict banner, honest tiles, real-or-empty EV chart, advanced-metrics disclosure, plain labels.
- `components/schedule/SchedulerHeader.tsx` — verdict-first KPI rail; remove duplicate title + Add/Export; plain relabels.

---

## Conventions & constraints

- **OTA-safe.** JS-only; no new native modules. `expo.version` stays `1.0.0` (runtime policy `appVersion`) so the change ships as an OTA update.
- **Styling.** `useThemedStyles` + `Colors`/`Type`/`Tokens` design tokens (no hex/inline size/radius literals — the anti-slop lint rules apply). `lucide-react-native` icons, amber accent.
- **Testing.** `utils/scheduleVerdict.ts` is covered by `scripts/validate-schedule-verdict.ts` (pure-fn, run via `bun run`). `npx tsc --noEmit` + `bun run lint` must stay clean. Visual verification is the **owner's** at merge — Claude cannot authenticate to the web app, so all changes must be blind-safe (no data-model risk; presentation only).
- **No behavior change to persistence, offline queue, or CPM outputs.** If any move requires touching those, stop and re-scope.

## Rollout

Phase 1 ships on its own (it is fully functional and testable without Phases 2–3). Phases 2 (fluent grid) and 3 (surface the power) each get their own spec → plan → implementation cycle and build on this shell.
