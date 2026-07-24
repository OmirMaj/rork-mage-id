# Productivity Feedback Loop ("Your Real Pace") — Design

**Date:** 2026-07-23
**Status:** Approved (design); ready for implementation plan
**Branch target:** `claude/productivity-loop` (off `main`)

## Goal

Close the actuals→estimates loop for TIME, the way the cost DB closed it for MONEY. When the AI schedule builder proposes "Framing — 7 days," the brain checks how long framing *actually* took on this contractor's past jobs and offers: **"Your pace: 9 days (4 jobs, medium confidence)"** — one tap to use it. The app literally gets more accurate every job it finishes.

Two parts, and the order matters:

1. **Capture (the flywheel):** as-built dates are stamped automatically when task status changes — because today they're only set by a manual Gantt tap (~5% coverage), and a learning engine over empty data is demo-ware.
2. **Learning + surfacing:** a pure `buildPaceBook` engine (the time-twin of `buildCostDatabase`) + a pace chip on the schedule-review screen.

## Grounding (verified in code, 2026-07-23)

- `ScheduleTask.actualStartDay/actualEndDay/actualStartDate/actualEndDate` exist (`types/index.ts:532`); today ONLY `InteractiveGantt.tsx:619-638` ("Start today"/"Finish today") sets them. Daily-report `workProgress` records % but never cascades to actuals. Time entries have no `taskId` (siloed — v2).
- AI builder durations come from `buildAnswersPrompt.ts` rules (stateless AI guesses; no access to past jobs). Review screen `app/schedule-review.tsx:195-210` renders per-task duration + rationale + assumption flag — the acceptance moment.
- Trade identity: `tradeKeyForTask(task)` / `inferTradeFromName` (`utils/scheduleColors.ts:30-55`) — conservative regex, `general` fallback, user-overridable `task.tradeKey`. Project size: `project.squareFootage`.
- Prior art: `diffAgainstBaseline` (plan-vs-plan), `scheduleEarnedValue` SPI (progress-%, not actuals). **No duration learning exists.** `buildCostDatabase` (`utils/costDatabase.ts`) is the proven pattern: samples → per-key entries → blend prior→actual with `w = n/(n+K)`, K=3, confidence by jobCount+variability.

## Part 1 — Auto-capture of actuals (pure helper + status-change seams)

**`utils/pace/stampActuals.ts`** — `stampActuals(task, newStatus, todayDayNumber, nowISO): Partial<ScheduleTask>`. Pure:
- status → `in_progress` and `actualStartDay` unset → `{ actualStartDay: todayDayNumber, actualStartDate: nowISO }`.
- status → `done` and `actualEndDay` unset → stamp end (+ retro-stamp start to `task.startDay` if unset, mirroring the Gantt's existing behavior at `InteractiveGantt.tsx:625-638`).
- Any other transition, or already-stamped → `{}`. Never overwrites an existing actual (the manual Gantt buttons stay authoritative).

Wire it into **every status-change path** (found by grepping `status` writes on tasks): the schedule-pro grid status edit, TaskInspector/modal status change, the classic mobile schedule status toggle, and the Gantt (which already stamps — helper no-ops there). Each site merges the helper's patch into its existing update. Existing behavior is unchanged when actuals are already set.

## Part 2 — The pace book (pure engine)

**`utils/pace/paceBook.ts`** — mirrors `costDatabase.ts`:

```ts
export interface PaceSample {
  projectId: string; projectName: string;
  trade: string;              // tradeKeyForTask
  sqftBucket: string;         // 'small' <2000 | 'medium' 2000-3500 | 'large' 3500-6000 | 'xlarge' >6000 | 'unknown'
  plannedDays: number;        // task.durationDays at the time
  actualDays: number;         // actualEndDay - actualStartDay + 1 (clamped >= 1)
  completedAt: string;
}
export interface PaceBookEntry {
  key: string;                // `${trade}|${sqftBucket}`
  trade: string; sqftBucket: string;
  sampleCount: number; jobCount: number;
  plannedMean: number; actualMean: number;
  variability: number;        // cv of actualDays
  bias: number;               // (actualMean - plannedMean) / plannedMean; >0 = you plan optimistic
  confidence: 'low' | 'medium' | 'high';   // jobCount>=5 && cv<=0.35 high; >=3 medium; else low
  samples: PaceSample[];
}
export function buildPaceBook(projects: Project[]): PaceBook;      // reads ALL projects' schedules; samples only tasks with BOTH actuals set; excludes milestones (durationDays 0)
export function lookupPace(book: PaceBook, trade: string, sqft: number | undefined): PaceBookEntry | null;  // exact bucket first, then trade-wide fallback (aggregated entry `${trade}|all`)
export function suggestDuration(entry: PaceBookEntry, proposedDays: number): number; // blend: w = jobCount/(jobCount+3); round(max(1, (1-w)*proposedDays + w*actualMean))
```

Sampling from **all** projects (not only closed) — a finished task on an active job is a valid pace sample; keying/blending mirrors the cost DB so the two "books" stay conceptually identical. Pure, no storage; computed via `useMemo` from ProjectContext where surfaced.

## Part 3 — Surfacing: the pace chip (schedule-review)

In `app/schedule-review.tsx` task cards: when `lookupPace` returns an entry with `confidence !== 'low'` and `suggestDuration` differs from the AI's duration by ≥1 day, render a **PaceChip**: `"Your pace: 9d (4 jobs)"` — tapping applies the suggested duration to that task (through the screen's existing task-edit path so CPM/review totals recompute). A small confidence dot (medium/high). Ignorable, never automatic — the AI's number stands unless tapped.

Empty/low-data state: no chip (silence, not noise). The book self-populates as Part 1's capture accumulates.

## Testing

`scripts/validate-pace.ts` in ship-check (`test:pace`): stampActuals transitions (start/done/retro-start/no-overwrite/no-op), bucket edges (1999/2000/3500/6000), sample construction (both-actuals-required, milestone exclusion, clamp ≥1), mean/bias/variability math on pinned fixtures, confidence bands, lookup fallback exact→trade-wide, suggestDuration blend pinned (e.g. 4 jobs, planned 7, actual mean 11 → w=4/7 → 9.29 → 9). tsc strict, anti-slop, full ship-check green.

## Out of scope (v2+)

- TimeEntry↔task linking (crew-hours learning); daily-report %→actuals cascade; recency weighting/decay; crew-size sqrt normalization; GridPane duration-edit hints; estimate-wizard timeline seeding; blending pace INTO AI generation silently (the chip keeps the user in control).

## Files

- **Create:** `utils/pace/stampActuals.ts`, `utils/pace/paceBook.ts`, `components/schedule/PaceChip.tsx`, `scripts/validate-pace.ts`
- **Modify:** status-change sites (schedule-pro grid, task inspector/modal, classic mobile schedule) to merge `stampActuals`, `app/schedule-review.tsx` (chip), `package.json` (validator)
- **Reference (unchanged):** `utils/scheduleColors.ts`, `utils/costDatabase.ts` (pattern), `components/schedule/InteractiveGantt.tsx` (existing stamping, untouched)
