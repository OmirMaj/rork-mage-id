# v2.2a — Backward-Pass Anchor Clamps — Design

Follow-up sub-project from the 2026-05-19 CPM audit. v2.1 made the engine internally consistent on EV + criticalPathDays + free-float; v2.3 wired cross-domain integrations; v2.2a closes audit bug #3 by teaching the backward pass to honor anchor constraints. The bigger engine refactor — calendar-aware CPM (audit bug #2) — is its own sub-project (v2.2b) for a fresh session.

Build target: p0-on-main worktree (`/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`), branch `claude/p0-launch-on-main` (currently 10 commits ahead of `main` @ `17c0c75` with v2.3 + polish already landed; v2.2a is the 11th commit). **Engine-only, OTA-able. No migration, no edge fn, no portal, no new dependency.**

## 1. Reality check (vs the audit + my own brainstorm)

The audit's bug #3 framing: "Backward pass ignores anchors. `backwardPass` (`utils/cpm.ts:385-444`) takes no `scheduleStart`. SNLT/FNLT/MFO clamps therefore can't tighten LF/LS, so `totalFloat` for a task with a finish-no-later anchor will be overstated."

Verified in the worktree:

- **Forward pass already applies anchor clamps** at `cpm.ts:355-368`. Uses the helper `computeAnchor(task, scheduleStart)` (verified — the helper is at `cpm.ts:159-176`; NOT `resolveAnchor` as my initial brainstorm inferred).
- **`computeAnchor` returns `AnchorClamp`** (interface declared at `cpm.ts:141-157`) with optional fields `esMin / esMax / efMin / efMax / esExact / efExact / alap`. The forward pass reads only the lower-bound fields (`esMin`, `efMin`, `esExact`, `efExact`) + the comment explicitly notes "esMax / efMax don't push ES earlier — they're enforced as warnings."
- **`backwardPass`** at `cpm.ts:385-444` is non-exported, called only by `runCpm` at `cpm.ts:655`. Its signature takes `(ordered, all, forward, projectFinish)` — no `scheduleStartDate`. Inside the walk, it computes `lf` from successor constraints only.
- **`RunCpmOptions.scheduleStartDate`** already exists at `cpm.ts:117`. The value is already threaded into `runCpm`. We just need to forward it to `backwardPass`.
- **ALAP** (`as-late-as-possible`) returns `{ alap: true }` only — no direct clamps. The backward-pass effect of ALAP is "let LF settle to projectFinish via the default", which the existing code already does. No backward-pass handling needed for ALAP.

## 2. Problem

A task with a `finish-no-later` anchor at day 20 should have LF capped at 20. Today's backward pass treats LF as `projectFinish` (say, day 100) when no successors constrain it, producing `totalFloat = LS − ES = 100 − ES` — phantom slack of 80 days. The task is reported as non-critical when it might actually be the binding constraint.

Same shape for `must-start-on`, `must-finish-on`, `start-no-later`. The forward pass already pushes ES forward via the anchor floor; the backward pass needs the mirror ceiling.

## 3. Goal / Non-goals

**Goal:** Backward pass produces engine-true LS/LF for anchored tasks. Total-float on tasks with SNLT/FNLT/MSO/MFO anchors becomes accurate. ALAP keeps working unchanged (the default LF=projectFinish behavior IS the ALAP behavior).

**Non-goals (YAGNI / scope / honesty):**

- NOT calendar-aware CPM (bug #2 — v2.2b). The engine staying calendar-blind is a known issue separate from anchor handling.
- NOT Gap E (`recalculateStartDays` + `runCpm` double-execution elimination). Own sub-project.
- NOT per-AIA-line `linkedTaskId`, active estimate→schedule re-sync, Supabase-snapshot URL fallback, `levelResources` UI surfacing. Each is its own sub-project.
- NOT changes to the forward-pass anchor block. It already handles lower-bound clamps correctly. v2.2a is backward-pass-only.
- NOT a new `RunCpmOptions` field. `scheduleStartDate` already exists.
- NO change to RevenueCat / tiers. No new entitlement keys. No migration. No edge fn. No portal change. No new dep.

## 4. Architecture

### 4.1 Extend `backwardPass` signature

Current (`cpm.ts:385`):
```ts
function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
): Map<string, { ls: number; lf: number }> {
```

Change to:
```ts
function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
  scheduleStartDate?: string,
): Map<string, { ls: number; lf: number }> {
```

### 4.2 Update the `runCpm` callsite

`runCpm` at `cpm.ts:655` currently calls `backwardPass(ordered, tasks, forward, projectFinish)`. Add the threaded value:

```ts
const backward = backwardPass(ordered, tasks, forward, projectFinish, options.scheduleStartDate);
```

### 4.3 Apply anchor clamps inside the backward walk

After the existing dependency-driven `lf` computation inside the `for (let i = ordered.length - 1; i >= 0; i--)` loop (around `cpm.ts:406-440`), and BEFORE the final `LS = LF - dur + 1` + `result.set(...)`, insert:

```ts
    // v2.2a — Backward-pass anchor clamps (mirror of the forward-pass
    // clamps at :355-368). Apply AFTER the dependency-derived LF so
    // anchors can only tighten LF, never relax it. Strictest of multiple
    // bounds wins via min(). ALAP needs no clamp — the default
    // lf = projectFinish IS "as late as possible".
    const anchor = computeAnchor(task, scheduleStartDate);
    if (anchor) {
      if (anchor.efExact !== undefined) {
        lf = anchor.efExact;
      } else if (anchor.efMax !== undefined && anchor.efMax < lf) {
        lf = anchor.efMax;
      }
      if (anchor.esExact !== undefined) {
        // Milestone-safe: for dur=0 the start IS the finish; for dur>0
        // pinning ES means LF = ES + dur - 1.
        lf = dur === 0 ? anchor.esExact : anchor.esExact + dur - 1;
      } else if (anchor.esMax !== undefined) {
        const req = dur === 0 ? anchor.esMax : anchor.esMax + dur - 1;
        if (req < lf) lf = req;
      }
    }
```

The existing `const ls = ...` and `result.set(task.id, { ls, lf })` lines below this stay unchanged.

### 4.4 Math reference per anchor type (full duration-aware table)

| Anchor | Semantically | Backward-pass clamp |
|---|---|---|
| `none` | — | no change |
| `start-no-earlier` (SNET) | start ≥ X | forward already handled via `esMin` — no backward change |
| `start-no-later` (SNLT) | start ≤ X | `esMax = X`. For dur=0: LF = X. For dur>0: LF = min(LF, X + dur − 1) |
| `finish-no-earlier` (FNET) | finish ≥ X | forward already handled via `efMin` — no backward change |
| `finish-no-later` (FNLT) | finish ≤ X | `efMax = X`. LF = min(LF, X) — duration-independent |
| `must-start-on` (MSO) | start = X | `esExact = X`. For dur=0: LF = X. For dur>0: LF = X + dur − 1 |
| `must-finish-on` (MFO) | finish = X | `efExact = X`. LF = X — duration-independent |
| `as-late-as-possible` (ALAP) | LS = projectFinish − dur + 1 | no backward-pass change — default LF=projectFinish is correct |

The dur-0 milestone math matches the forward pass's `dur === 0 ? exact : exact - dur + 1` pattern in mirror (`+ dur − 1` instead of `− dur + 1`).

### 4.5 Order matters within the clamp block

`esExact`/`efExact` are HARD pins — they OVERRIDE the dependency-derived LF, not just tighten it. So the code uses unconditional assignment (`lf = anchor.esExact + dur - 1`) for the exact branches, vs `if (... < lf) lf = ...` for the max-only soft-cap branches. This mirrors the forward pass's pattern at `cpm.ts:362-367` where `efExact` does `es = anchor.efExact - dur + 1` unconditionally while `efMin` does `if (req > es) es = req`.

If both `esExact` and `efExact` are set (shouldn't happen in practice — `computeAnchor` returns only one of them per anchor type — but defense-in-depth), `esExact` wins because it's evaluated after `efExact` in the code order. The forward pass uses the same order, so the two passes agree on the result.

## 5. Error handling / correctness

- All changes are pure additive within a single function body. No throws added; existing dependency-driven LF computation unchanged.
- `computeAnchor(task, undefined)` returns null when `scheduleStartDate` is absent — the anchor block is skipped, identical to current behavior. Zero regression for callers that don't pass `scheduleStartDate`.
- `computeAnchor(task, scheduleStart)` returns null when `task.anchorType === 'none'` or when `task.anchorDate` is invalid — anchor block skipped.
- Multiple anchor types on one task: not possible — `task.anchorType` is a single union. So at most one anchor produces fields.
- `dur === 0` milestone math matches the forward-pass convention. Verified by reading `cpm.ts:355-368` and mirroring.
- ALAP returns `{ alap: true }` only — the new backward-pass block reads only `efExact`/`efMax`/`esExact`/`esMax`, so it's a no-op for ALAP. The default `lf = projectFinish` IS ALAP semantics. ✓
- Strict TS, no `any`. `npx tsc --noEmit` clean.

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + spot-check reasoning against the 4 audit reproducers + 1 ALAP-no-regression check:

1. **FNLT** — task B (dur=3) with `finish-no-later` at day 20. Pre-fix: backward pass sets `lf = projectFinish` (say 100), `ls = 98`, `totalFloat = 98 − ES`. Post-fix: `lf = 20`, `ls = 18`, `totalFloat = 18 − ES`. Correct.
2. **MFO** — milestone (dur=0) with `must-finish-on` at day 15. Pre-fix: `lf = 100`. Post-fix: `lf = 15`, `ls = 15` (dur-0 special case).
3. **MSO** — task C (dur=5) with `must-start-on` at day 10. Post-fix: `lf = 10 + 5 − 1 = 14`, `ls = 10`. Confirmed forward-pass + backward-pass agree on ES=LS=10.
4. **SNLT** — task D (dur=4) with `start-no-later` at day 25. Post-fix: `lf = min(lf, 25 + 4 − 1) = min(lf, 28)`. Only tightens; relaxes nothing.
5. **No-anchor regression** — task E with no anchor (`anchorType === 'none'` or undefined). `computeAnchor` returns null → anchor block skipped → behavior byte-identical to pre-fix.
6. **ALAP no-regression** — task F with `as-late-as-possible`. `computeAnchor` returns `{ alap: true }` only (no clamp fields). The backward block reads `efExact / efMax / esExact / esMax` — all undefined → block is a no-op. Default `lf = projectFinish` is the ALAP semantic. ✓

Grep assertion: `grep -nE "v2.2a" utils/cpm.ts` returns 1 match (the marker comment inside the new clamp block).

Final gate: opus whole-impl review.

## 7. Out of scope / future

- **v2.2b — Calendar-aware CPM (audit bug #2).** `runCpm` consumes `workingDaysPerWeek` + `nonWorkingDates` + per-resource calendars (via `resolveCalendarForTask` in `utils/scheduleResourceCalendars.ts`) so forward/backward walks skip non-working days. Genuinely 2-3x v2.1's size — own session.
- **Gap E — `recalculateStartDays` + `runCpm` double-execution elimination.** Touches the persist flow contract in `schedule-pro.tsx`. Own sub-project once a contract decision is made about whether `task.startDay` should always reflect engine ES post-edit.
- **Per-AIA-line `linkedTaskId` field + per-line schedule mapping.** Schema-shape change on `SavedAIAPayAppLine` + per-line wire-up. Extends v2.3 A2.
- **Active estimate→schedule re-sync** on item edit. Extends v2.3 C (telemetry-only).
- **Active Supabase-snapshot URL fallback** mirroring `sub_portal_snapshots`. Extends v2.3 P1.
- **`runCpm({ levelResources: true })`** UI surfacing or removal. Product decision.

## 8. Touched-file ledger (locked scope)

| # | File | Change |
|---|---|---|
| 1 | `utils/cpm.ts` | Extend `backwardPass` signature with `scheduleStartDate?: string`; insert anchor-clamp block inside the backward walk; pass `options.scheduleStartDate` from `runCpm` callsite. |

**1 file touched, 0 deleted, 0 created.** Single-file engine change. No call-site changes outside `cpm.ts` (`backwardPass` is non-exported; `runCpm` is the only consumer). Sized like one v2.1 task. No migration, no edge fn, no portal, no new dep.
