# v2.2a Backward-Pass Anchor Clamps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Single-task plan; one commit.

**Goal:** Backward pass honors SNLT/FNLT/MSO/MFO anchors so total-float on anchored tasks becomes engine-true.

**Architecture:** One file, one commit. Mirror the forward-pass anchor block (`utils/cpm.ts:355-368`) inside `backwardPass`, threading `scheduleStartDate` through from existing `RunCpmOptions`.

**Tech Stack:** TypeScript (strict mode). No new dep. No migration. No edge fn.

Worktree: `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`. Branch: `claude/p0-launch-on-main` (HEAD `9078d9e` after v2.2a spec landed; main is at `17c0c75` with 11 commits ahead including v2.3 + polish + v2.2a spec). Spec: `docs/superpowers/specs/2026-05-20-v2-2a-backward-pass-anchor-clamps-design.md`.

---

## File ledger (locked scope — 1 file modified, 0 deleted, 0 created)

| File | Change |
|---|---|
| `utils/cpm.ts` | Extend `backwardPass` signature; thread `scheduleStartDate` from `runCpm`; insert anchor-clamp block inside the backward walk. |

**Files NOT touched:** every other file in the repo. `backwardPass` is non-exported; `runCpm` is its only caller; downstream consumers see only different LS/LF/totalFloat for anchored tasks (and identical results for unanchored tasks).

---

## Task 1: Backward-pass anchor clamps (single commit)

**Files:**
- Modify: `utils/cpm.ts` (signature change at ~`:385`, callsite update at ~`:655`, anchor clamp insertion inside the backward walk at ~`:406-440`).

### - [ ] Step 1.1: Read the current `backwardPass` body in full

Run:
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main"
sed -n '385,445p' utils/cpm.ts
```
Expected: see the full function body. Note the local variable names (the loop variable `task`, the working `lf` variable, the `dur` derivation, the final `ls = lf - dur + 1` and `result.set(task.id, { ls, lf })`). The clamp block must be inserted AFTER the dependency-driven `lf` computation but BEFORE the `const ls = ...` line.

### - [ ] Step 1.2: Read the existing forward-pass anchor block for reference

Run:
```bash
sed -n '350,375p' utils/cpm.ts
```
Expected: see lines 355-368 with the forward-pass anchor handling. Note the pattern:
- `if (anchor.esExact !== undefined) es = anchor.esExact;` — hard pin, unconditional assignment
- `if (anchor.esMin !== undefined && anchor.esMin > es) es = anchor.esMin;` — soft floor, `>` check
- `if (anchor.efMin !== undefined) { const req = dur === 0 ? anchor.efMin : anchor.efMin - dur + 1; if (req > es) es = req; }` — dur-aware soft floor
- `if (anchor.efExact !== undefined) { es = dur === 0 ? anchor.efExact : anchor.efExact - dur + 1; }` — dur-aware hard pin

Confirm `computeAnchor(task, scheduleStart)` is called here (line 354 area). The backward pass will use the same helper.

### - [ ] Step 1.3: Extend `backwardPass` signature

In `utils/cpm.ts`, find the current signature at line 385:

```ts
function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
): Map<string, { ls: number; lf: number }> {
```

Replace with:

```ts
function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
  scheduleStartDate?: string,
): Map<string, { ls: number; lf: number }> {
```

### - [ ] Step 1.4: Insert the anchor-clamp block inside the backward walk

In `utils/cpm.ts`, inside the `for (let i = ordered.length - 1; i >= 0; i--)` loop body. Find the existing code that:
1. Computes `lf` from successors (the dependency-driven LF derivation; ends around `:436-440`).
2. Then writes `const ls = lf - dur + 1` (or similar).
3. Then `result.set(task.id, { ls, lf })`.

**Insert this block BETWEEN the dependency-driven `lf` computation AND the `const ls = ...` line:**

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
        lf = dur === 0 ? anchor.esExact : anchor.esExact + dur - 1;
      } else if (anchor.esMax !== undefined) {
        const req = dur === 0 ? anchor.esMax : anchor.esMax + dur - 1;
        if (req < lf) lf = req;
      }
    }
```

**Important variable-name verification before pasting:**

- The working LF variable inside the loop must be named `lf` (lowercase). If the existing body uses a different name (e.g. `latestFinish`), adapt every occurrence in the new block.
- The loop variable is `task` (per the forward-pass pattern).
- `dur` must already be in scope at this point in the loop body. If the existing code computes `dur` later (after where you're inserting), either move the `dur` computation up OR inline `Math.max(0, task.durationDays || 0)` inside the new block.

Re-read the loop body before pasting to confirm. If any of these don't match, report BLOCKED so the controller can adjust the spec.

### - [ ] Step 1.5: Update the `runCpm` callsite

In `utils/cpm.ts`, find the `backwardPass(...)` call inside `runCpm` (around line 655):

```ts
const backward = backwardPass(ordered, tasks, forward, projectFinish);
```

Replace with:

```ts
const backward = backwardPass(ordered, tasks, forward, projectFinish, options.scheduleStartDate);
```

`options` is already in scope (it's the `RunCpmOptions` arg destructured/used elsewhere in `runCpm`).

### - [ ] Step 1.6: tsc gate

Run:
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main"
npx tsc --noEmit
```
Expected: 0 errors.

### - [ ] Step 1.7: Grep assertions

```bash
# Marker comment present
grep -nE "v2.2a" utils/cpm.ts
```
Expected: 1 match (the marker comment in the new clamp block).

```bash
# computeAnchor called from both passes
grep -nE "computeAnchor\(task" utils/cpm.ts
```
Expected: at least 2 matches (forward pass at ~`:354` + backward pass in the new block).

```bash
# Signature change visible
grep -nE "scheduleStartDate\?: string" utils/cpm.ts
```
Expected: at least 1 match (the new `backwardPass` parameter). Note: `RunCpmOptions.scheduleStartDate?: string` is at `:117` — already present pre-fix; this grep counts the new `backwardPass` parameter.

```bash
# Scope narrow
git diff --stat HEAD~1..HEAD 2>/dev/null || git diff --stat
```
Expected: ONLY `utils/cpm.ts` changed.

### - [ ] Step 1.8: Self-review

- Read the final `backwardPass` body. Confirm the clamp block is inserted between the dependency-driven `lf` computation and the `const ls = ...` line.
- The marker comment "v2.2a" must be in the new block (for the grep assertion).
- No `any` introduced. The `anchor` variable is typed by `computeAnchor`'s return type (`AnchorClamp | null`).
- The `dur === 0 ? ... : ... + dur - 1` math mirrors the forward pass's `dur === 0 ? ... : ... - dur + 1` (sign flipped because we're computing LF from a START anchor, not ES from a FINISH anchor).
- ALAP regression check: `computeAnchor` for an ALAP task returns `{ alap: true }` only. The new block reads `efExact/efMax/esExact/esMax` — all undefined for ALAP → block is a no-op. Default `lf = projectFinish` is correct ALAP behavior. ✓
- No-anchor regression check: `computeAnchor(task, scheduleStartDate)` returns `null` when `task.anchorType === 'none'` or `'' === undefined` OR when `scheduleStartDate` is missing. The `if (anchor) { ... }` guard skips the block entirely. Behavior byte-identical to pre-fix for unanchored tasks. ✓

### - [ ] Step 1.9: Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main"
git add utils/cpm.ts
git commit -m "$(cat <<'EOF'
fix(cpm): backward pass honors anchor clamps (v2.2a — audit bug #3)

The backward pass at utils/cpm.ts:385 ignored anchor constraints,
producing phantom slack on tasks with finish-no-later /
start-no-later / must-start-on / must-finish-on anchors. Total-float
for a task with finish-no-later at day 20 reported as
(projectFinish − ES) instead of (20 − ES).

Fix mirrors the forward-pass anchor block at :355-368:
  1. Extend backwardPass signature with scheduleStartDate?: string.
  2. Thread options.scheduleStartDate from runCpm.
  3. Inside the backward walk, call computeAnchor(task, scheduleStartDate)
     after the dependency-driven LF computation; apply efExact / efMax /
     esExact / esMax clamps. Hard pins (Exact) override; soft caps (Max)
     only tighten via min().

ALAP needs no clamp — computeAnchor returns { alap: true } only and the
new block reads only the clamp fields. Default lf = projectFinish IS
the ALAP semantic.

Math is duration-aware: dur=0 milestones pin LF to the exact value;
dur>0 tasks compute LF = ES_pin + dur − 1 (mirror of the forward pass's
ES = EF_pin − dur + 1).

Single-file engine change. backwardPass is non-exported; runCpm is its
only caller. Downstream consumers see correct LS/LF/totalFloat on
anchored tasks; unanchored tasks unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final whole-impl gates

After Task 1's single commit lands:

### - [ ] Gate A: tsc clean repo-wide

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main"
npx tsc --noEmit
```
Expected: 0 errors.

### - [ ] Gate B: scope ledger

```bash
git diff --stat HEAD~1..HEAD
```
Expected: ONLY `utils/cpm.ts` changed.

### - [ ] Gate C: math reasoning spot-checks

Walk each anchor type in the head:
- FNLT (`efMax`): clamp applies via the `efMax < lf` soft-cap branch.
- MFO (`efExact`): unconditional hard pin `lf = anchor.efExact`.
- MSO (`esExact`): unconditional hard pin via `lf = esExact + dur - 1` (dur-aware).
- SNLT (`esMax`): soft cap via `req = esMax + dur - 1; if (req < lf) lf = req` (dur-aware).
- SNET (`esMin`)  / FNET (`efMin`): NO backward-pass effect — verified by absence of those fields in the new block.
- ALAP (`alap`): no-op — block reads none of these fields.
- `none` / missing `scheduleStartDate`: `computeAnchor` returns null → block skipped.

### - [ ] Gate D: no-anchor regression check (read-only reasoning)

For a schedule with zero anchored tasks: every iteration's `computeAnchor` returns `null` (because `task.anchorType` is undefined or `'none'`). The new `if (anchor) { ... }` block is dead. The remaining code path is byte-identical to pre-fix. Schedule-pro, project-detail, EVM, pdfGenerator, etc. all see the same LS/LF/totalFloat values they saw before. Zero regression.

---

## Opus whole-impl review dispatch

Dispatch one opus review with this scope:

1. Confirm only `utils/cpm.ts` changed.
2. `backwardPass` signature now accepts `scheduleStartDate?: string`.
3. `runCpm` callsite threads `options.scheduleStartDate`.
4. New clamp block inside the backward walk:
   - Calls `computeAnchor(task, scheduleStartDate)` — exact helper name matches existing code (NOT `resolveAnchor`).
   - Reads `efExact / efMax / esExact / esMax` fields only.
   - `efExact` is unconditional pin; `efMax` is `< lf` soft cap.
   - `esExact` is dur-aware unconditional pin (`dur === 0 ? esExact : esExact + dur - 1`).
   - `esMax` is dur-aware soft cap.
5. Marker comment `v2.2a` present in the new block.
6. No `any` introduced; no new dep in `package.json`.
7. tsc clean.
8. Final verdict APPROVED / NEEDS-CHANGES with file:line evidence.

---

## Ship section — BATCHED

Per the controller's batch directive, v2.2a's single commit joins the existing 10 unshipped commits on `claude/p0-launch-on-main`. The full batched ship happens AFTER the opus review APPROVES:

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git checkout main
git pull origin main
git merge --ff-only claude/p0-launch-on-main
git push origin main
eas update --branch production --message "v2.3 wedge integrations + polish + v2.2a backward-pass anchors (schedule→invoice/AIA prefill, sub→master rollup, stale-item telemetry, URL guard, deps dedup, debounce-race fix, bundles fix, anchor LF clamps)"
```

NO edge fn deploy (none changed). NO migration (none).
