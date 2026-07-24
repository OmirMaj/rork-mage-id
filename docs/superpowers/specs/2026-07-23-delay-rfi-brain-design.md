# Delay Cascade + RFI Brain — Design

**Date:** 2026-07-23
**Status:** Approved (design); ready for implementation plan
**Branch target:** `claude/delay-rfi-brain` (off `main`)

## Goal

Connect the field's words to the schedule's math, and the past's answers to today's questions:

1. **Delay cascade** — a daily report says *"inspector no-show, rough-in pushed 2 days."* One tap shows the downstream ripple — which tasks slide, what turns critical, how many days the finish slips — and offers to apply the reflow. Catch the compound delay the week it starts.
2. **RFI brain** — on an open RFI: a **"MAGE suggests"** button drafts a response from how similar RFIs on this project were answered before (cited), plus an **overdue banner** and a **"blocks a critical-path task"** warning when the RFI is linked to a task.

## Design principles

- **AI proposes, the user confirms, the engine computes.** The AI's only job is reading `issuesAndDelays` free text into `{taskGuess, deltaDays, quote}`; the user confirms/adjusts the matched task and days; every schedule number comes from the existing pure CPM pipeline.
- **Maximal reuse.** The ripple preview/apply flow is the copilot web-edit machinery used verbatim — this feature is a new *entrance* to it, not new schedule math.

## Grounding (verified in code, 2026-07-23)

- **The whole ripple pipeline exists** and is pure: `interpretScheduleOps(ops, tasks)` with `{op:'move', task, deltaDays}` (`utils/copilot/scheduleEdit/editOps.ts`/`interpretOps.ts`), `runCpm(tasks, options) → CpmResult{perTask: Map<id,{totalFloat,isCritical,…}>, criticalPath, projectFinish}` (`utils/cpm.ts:72-89`), `diffSchedule(before, next, cpmBefore, cpmAfter) → ScheduleDiff{finishDeltaDays, moved, criticalEntered, rejected}`, `<ScheduleDiffView ops ctx onApply onDiscard>` (`components/copilot/ScheduleDiffView.tsx`), `applyToProjectSchedule(schedule, nextTasks, cpmOptions)`.
- `app/daily-report.tsx` already has `project?.schedule?.tasks` in context (:137) and `issuesAndDelays` free text (:119). The profit-leak scan-card pattern (branch `claude/profit-leak`) is the UI template — since that branch is unmerged, this feature builds its own card on main with the same shape (the two will co-exist cleanly; both are additive sections).
- `RFI` type has `linkedTaskId?`, `dateRequired`, `status`, `response`, `ballInCourt` (`types/index.ts:2813-2849`); `app/rfi.tsx` already renders a task picker (:120-138). RFIs are indexed into project memory (`utils/projectMemory.ts:62-65`, source 'RFI') and `answerFromMemorySemantic(question, projectId, docs) → MemoryAnswer{answer, usedRefs, …}` (:251-288) is callable today.
- **Cross-project RFI memory is NOT possible today** — `match_project_memory` is project-scoped by design (migration `20260608010000` WHERE clause). v1 is same-project; a `match_project_memory_user_wide` RPC is a documented follow-up (owner-gated migration).
- Overdue RFI counting already exists in `weekly-snapshot.tsx` / `report-inbox.tsx` — v1 adds the *detail-screen* banner, not a reminder system.

## Architecture

### 1. Delay scan (daily report)

**Pure:** `utils/delayScan/delayPrompt.ts` — `buildDelayPrompt(issuesText, taskTitles): string` + `coerceDelayResult(raw): DelayScanResult`:
```ts
export interface DelayScanResult {
  hits: DelayHit[];               // empty = no delay language found
}
export interface DelayHit {
  taskTitleGuess: string;         // best-match against the provided task titles (verbatim from the list, or '')
  deltaDays: number;              // parsed days (>=1; 'pushed 2 days' → 2; vague → 1)
  quote: string;                  // the report phrase
}
```
`matchTaskByTitle(guess, tasks): ScheduleTask | null` — normalized exact-then-substring match; null when ambiguous.

**Flow (in `app/daily-report.tsx`, when `issuesAndDelays` is non-empty on a saved report):** a "Check schedule impact" action → `mageAI({feature:'delayScan', tier:'fast', schemaHint, cacheKey: delay_<reportId>_<hash(issues)>})` → for each hit, a **confirm row**: matched task (tappable picker, pre-selected from the guess) + delta-days stepper + the quote. Confirm → build `ops=[{op:'move', task:id, deltaDays}]` → `interpretScheduleOps` + `runCpm` before/after + `diffSchedule` → render **`ScheduleDiffView`** with its own Apply/Discard; Apply → `applyToProjectSchedule` → `updateProject`. No hits → "No delay language detected." Register `delayScan` in `AIFeature` + `FEATURE_CONFIG` (fast tier).

### 2. RFI brain (`app/rfi.tsx`)

- **Suggest answer:** "MAGE suggests" button under the response field (enabled when `question` non-empty): `extractMemoryDocs({rfis: getRFIsForProject(projectId), …})` → `answerFromMemorySemantic(question, projectId, docs)` → fill `response` + a citation line ("Drafted from RFI #4, #9 — review before sending"). Loading/error states mirror the existing AI-button pattern; a failure leaves the field untouched.
- **Overdue banner:** top of the form when `status==='open' && dateRequired < today`: "Response due N days ago" — semantic danger tokens.
- **Critical-path warning:** pure helper `utils/delayScan/rfiBlocking.ts` — `rfiBlockStatus(rfi, schedule, cpmOptions): {critical: boolean, taskTitle?: string, totalFloat?: number}` (memoized `runCpm`; null-safe when no `linkedTaskId`/schedule). When critical: banner adds "— blocks '<task>' on the critical path."

## Testing

`scripts/validate-delay-rfi.ts` in ship-check (`test:delay-rfi`): prompt grounding rules (titles list embedded, quote required, prefer empty), `coerceDelayResult` (clamps deltaDays ≥1, drops garbage/oversize, empty-safe), `matchTaskByTitle` (exact, substring, ambiguity→null, case/whitespace), `rfiBlockStatus` (critical vs float, no-link, no-schedule, done-task no-warn). The ripple math itself is NOT re-tested — it's the already-validated CPM/diff pipeline. tsc strict, anti-slop, full ship-check green.

## Out of scope (v2+)

- Cross-project RFI memory (`match_project_memory_user_wide` RPC — owner-gated migration); RFI reminders/notifications; auto-scan on report save; RFI-as-CPM-constraint modeling; Brain Watch integration (when that branch lands).

## Files

- **Create:** `utils/delayScan/delayPrompt.ts`, `utils/delayScan/matchTask.ts`, `utils/delayScan/rfiBlocking.ts`, `scripts/validate-delay-rfi.ts`
- **Modify:** `app/daily-report.tsx` (impact card + confirm rows + ScheduleDiffView mount), `app/rfi.tsx` (suggest button + banners), `utils/aiRateLimiterCore.ts` (`delayScan`), `package.json` (validator)
- **Reference (unchanged):** `utils/copilot/scheduleEdit/*`, `utils/cpm.ts`, `components/copilot/ScheduleDiffView.tsx`, `utils/projectMemory.ts`
