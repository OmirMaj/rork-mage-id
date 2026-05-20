# v2.3 Wedge Integrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire three cross-domain data flows the schedule already implies but never produces (invoice prefill, AIA sync, sub-update rollup), plus stale-item telemetry and a share-URL size guard. Document the mobile-tier policy decision.

**Architecture:** Pure additive — 5 files touched, 0 deleted, 0 created. No migration, no edge fn, no portal, no new dep. Per-task gate is `npx tsc --noEmit` clean + spec §6 reasoning. No unit-test runner in this repo — verification is `tsc` + grep assertions + manual spot-checks on the audit's reproducer scenarios.

**Tech Stack:** TypeScript (strict mode), React Native (Expo Router 6), Supabase (no schema change). Worktree at `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main` == main @ `17c0c75`. Spec at `docs/superpowers/specs/2026-05-20-v2-3-wedge-integrations-design.md` (committed `2432668`).

---

## File ledger (locked scope — 5 modified, 0 deleted, 0 created)

| # | File | Wire | Task |
|---|---|---|---|
| 1 | `app/invoice.tsx` | A1 — replace `'30'` literal at `:237` with `legacyEvmMetrics`-derived prefill | Task 1 |
| 2 | `app/aia-pay-app.tsx` | A2 — `handleSyncFromSchedule` useCallback + UI button | Task 2 |
| 3 | `app/schedule-pro.tsx` | B (sub-update→master rollup useEffect) + P1 (catch `ShareTokenTooLargeError` around `encodeShareToken` callsite at `:828`) | Tasks 3 + 5 |
| 4 | `utils/scheduleEarnedValue.ts` | C — `console.warn` on stale `linkedEstimateItems` in `buildEarnedValueSnapshot` task loop | Task 4 |
| 5 | `utils/scheduleOps.ts` | P1 — `ShareTokenTooLargeError` class + `MAX_SHARE_TOKEN_LENGTH` constant + size check at the end of `encodeShareToken` | Task 5 |

**Files NOT touched** (verify each task's diff stays narrow):

`contexts/ProjectContext.tsx`, `app/schedule-wizard.tsx`, `app/project-detail.tsx`, `app/(tabs)/schedule/index.tsx` (P2 deliberate no-gate decision), `utils/aiService.ts`, `utils/pdfGenerator.ts`, `components/schedule/SchedulerHeader.tsx`, `components/schedule/tabs/DashboardTab.tsx`, `components/schedule/SchedulerContext.tsx`, `components/schedule/SubUpdatesPanel.tsx` (data-flow stays inside that component for the panel; Task 3 does its own loadSubUpdates), the other schedule-related utils, the other `components/schedule/*` files, `hooks/useTierAccess.ts`, `package.json`.

---

## Task 1: A1 — Invoice `progressPercent` prefill

**Files:**
- Modify: `app/invoice.tsx` (import block + line 237's `useState` initializer)

- [ ] **Step 1.1: Read the current `progressPercent` initializer**

Run: `sed -n '230,245p' app/invoice.tsx`
Expected: see line 237's `useState(existingInvoice?.progressPercent?.toString() ?? '30')` initializer.

- [ ] **Step 1.2: Add the import**

In `app/invoice.tsx`, find the existing import block (lines 1-44). After the `useProjects` import (around line 22), add a new import line:

```ts
import { legacyEvmMetrics } from '@/utils/scheduleEarnedValue';
```

Place it adjacent to other `@/utils/...` imports for consistency (e.g., near `import { generateInvoicePDF, generateInvoicePDFUri } from '@/utils/pdfGenerator';`).

- [ ] **Step 1.3: Replace the `useState` initializer**

In `app/invoice.tsx`, find this block (currently around line 237):

```ts
  const [progressPercent, setProgressPercent] = useState(
    existingInvoice?.progressPercent?.toString() ?? '30'
  );
```

Replace with:

```ts
  const [progressPercent, setProgressPercent] = useState(() => {
    if (existingInvoice?.progressPercent != null) {
      return existingInvoice.progressPercent.toString();
    }
    // v2.3 wedge A1 — prefill from the canonical EV pipeline.
    // legacyEvmMetrics returns percentComplete = (EV/BAC × 100) cost-weighted.
    // Falls back to 30 only when there's no schedule or no linked estimate.
    if (project?.schedule && project.linkedEstimate) {
      const metrics = legacyEvmMetrics(project, [], project.schedule);
      if (metrics.percentComplete > 0) {
        return Math.round(metrics.percentComplete).toString();
      }
    }
    return '30';
  });
```

**Note:** `project` must be in scope at this line. It is — `useProjects().getProject(projectId)` or equivalent runs earlier in the component, exposing `project` to the body. Verify by looking at the surrounding `existingInvoice` derivation; if `project` is named differently in this scope, adapt the variable name accordingly.

- [ ] **Step 1.4: tsc gate**

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 1.5: Grep assertion**

Run: `grep -nE "legacyEvmMetrics" app/invoice.tsx`
Expected: 2 matches (1 import line + 1 callsite in the initializer).

Run: `git diff --stat HEAD~1..HEAD -- app/invoice.tsx 2>/dev/null; git diff --stat -- app/invoice.tsx`
Expected: one file changed.

- [ ] **Step 1.6: Commit**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main"
git add app/invoice.tsx
git commit -m "$(cat <<'EOF'
feat(invoice): prefill progressPercent from schedule EV (v2.3 wedge A1)

Replaces the bare '30' literal at app/invoice.tsx:237 with a schedule-
derived value when both a schedule and a linked estimate are present.
Falls back to 30 only when one of those is absent (so a fresh project
still has a sane starting point).

Uses legacyEvmMetrics — the canonical EV pipeline from v2.1. percentComplete
is cost-weighted (EV/BAC × 100) — far more defensible than the guessed
30% placeholder. Empty invoices arg gives cpi=1 (we only need
percentComplete for prefill; AC is not relevant here).

The actual invoice being created is excluded from its own prefill input,
which is the correct semantic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: A2 — AIA "Sync from schedule" button

**Files:**
- Modify: `app/aia-pay-app.tsx` (import block + new useCallback + new button UI)

- [ ] **Step 2.1: Read the current `applyPercentToLine` body + UI placement**

Run: `grep -nE "applyPercentToLine|updateRetainagePctAll|Sync from schedule" app/aia-pay-app.tsx | head -10`
Expected: locate the existing `applyPercentToLine` useCallback (around line 173) and `updateRetainagePctAll` useCallback (around line 189). The new `handleSyncFromSchedule` sits immediately after these.

Read the surrounding UI area (look for the header action buttons or the line-actions toolbar): `grep -nE "TouchableOpacity.*onPress" app/aia-pay-app.tsx | head -20` to find where existing buttons live. Place the new "Sync from schedule" button in the same area as other header-level actions (e.g., near "Save" or "Print" buttons — implementer picks the spot that matches the file's conventions).

- [ ] **Step 2.2: Add the import**

In `app/aia-pay-app.tsx`, find the existing import block. Verify `Alert` is already imported (line 4) and `Haptics` is already imported (line 8). Add ONE new import:

```ts
import { legacyEvmMetrics } from '@/utils/scheduleEarnedValue';
```

Place it adjacent to other `@/utils/...` imports (e.g., near `import { useProjects } from '@/contexts/ProjectContext';` or near the `aiaBilling` imports).

- [ ] **Step 2.3: Add the `handleSyncFromSchedule` useCallback**

In `app/aia-pay-app.tsx`, immediately after the existing `updateRetainagePctAll` useCallback (around line 195), insert:

```ts
  // v2.3 wedge A2 — apply the project-level cost-weighted EV % to every
  // AIA line. Per-line linkedTaskId mapping (a SavedAIAPayAppLine field)
  // is its own sub-project — this is project-level sync only.
  const handleSyncFromSchedule = useCallback(() => {
    if (!project?.schedule || !project.linkedEstimate || !app) {
      Alert.alert(
        'No schedule data',
        'Link a schedule with a linked estimate to use this action.'
      );
      return;
    }
    const metrics = legacyEvmMetrics(project, [], project.schedule);
    const pct = Math.round(metrics.percentComplete);
    if (pct <= 0) {
      Alert.alert(
        'No progress yet',
        'Schedule shows 0% complete. Update task progress first.'
      );
      return;
    }
    app.lines.forEach(line => applyPercentToLine(line.id, pct));
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, app, applyPercentToLine]);
```

**Variable name check:** verify the in-scope state variable for the AIA pay app is named `app` (per the existing `applyPercentToLine` body using `setApp(prev => ...)`). If it's named differently in this file, adapt.

- [ ] **Step 2.4: Add the UI button**

Find an appropriate header-action area in the JSX (search for existing `TouchableOpacity` buttons like "Save", "Print", or "Generate PDF"). Add a new TouchableOpacity immediately adjacent. Use existing button styles (`styles.headerActionBtn` or whatever the file's pattern is — re-read the surrounding JSX to match):

```tsx
              <TouchableOpacity
                onPress={handleSyncFromSchedule}
                style={styles.headerActionBtn}
                testID="aia-sync-from-schedule"
              >
                <Text style={styles.headerActionText}>Sync from schedule</Text>
              </TouchableOpacity>
```

If the existing button style is different (e.g., `styles.primaryBtn`, `styles.secondaryBtn`), use the file's actual pattern. **Re-read the JSX section** to pick the right styles + the right wrapping container before applying.

If a header-action area doesn't exist (the file uses inline action chips instead), place the button in the most prominent existing action surface — adapt at gate time.

- [ ] **Step 2.5: tsc gate**

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2.6: Grep assertions**

Run: `grep -nE "handleSyncFromSchedule|Sync from schedule" app/aia-pay-app.tsx`
Expected: at least 3 matches (1 useCallback definition + 1 button onPress + 1 button text).

Run: `grep -nE "legacyEvmMetrics" app/aia-pay-app.tsx`
Expected: 2 matches (1 import + 1 callsite).

- [ ] **Step 2.7: Commit**

```bash
git add app/aia-pay-app.tsx
git commit -m "$(cat <<'EOF'
feat(aia): Sync from schedule button — apply project EV % to lines (v2.3 wedge A2)

Adds handleSyncFromSchedule useCallback in app/aia-pay-app.tsx that applies
the project-level cost-weighted EV % (from legacyEvmMetrics) to every AIA
line via applyPercentToLine. Friendly Alerts on missing schedule/estimate
data and zero-progress edge cases. Haptics.success on apply.

Per-line linkedTaskId mapping is explicitly out of scope —
SavedAIAPayAppLine has no such field today and adding it is its own
sub-project. v2.3 ships project-level sync only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: B — Sub update → master task progress rollup

**Files:**
- Modify: `app/schedule-pro.tsx` (new import + new useEffect)

- [ ] **Step 3.1: Read the relevant scope in schedule-pro.tsx**

Run: `grep -nE "loadSubUpdates|setWorkingTasks|workingTasks|subUpdates" app/schedule-pro.tsx | head -20`

Expected:
- `loadSubUpdates` is NOT yet imported (need to add).
- `workingTasks` / `setWorkingTasks` declared around line 135 (a `useState<ScheduleTask[]>`).
- The file does NOT itself read sub updates today — `SubUpdatesPanel` (consumed at `:1130`) does that internally via `loadSubUpdates(projectId)`.

This means Task 3 must add its own `loadSubUpdates` call in schedule-pro. Slight redundancy with SubUpdatesPanel (both fetch the same AsyncStorage data), but keeps the master-progress rollup concern at the screen level where `setWorkingTasks` lives.

- [ ] **Step 3.2: Add the import**

In `app/schedule-pro.tsx`, find the existing import block. Locate the line that imports from `@/utils/subScheduleUpdatesStorage` if any; if not, add a new import:

```ts
import { loadSubUpdates } from '@/utils/subScheduleUpdatesStorage';
```

Place it adjacent to other `@/utils/` imports (e.g., near `import { encodeShareToken, buildSharePayload } from '@/utils/scheduleOps';` around line 76).

Also verify `SubScheduleUpdate` is importable from `@/types` if needed for typing. (The useEffect doesn't explicitly type-annotate `latestByTask`, so this may not be required — but if tsc complains, add `import type { SubScheduleUpdate } from '@/types';`.)

- [ ] **Step 3.3: Add the rollup useEffect**

In `app/schedule-pro.tsx`, find a location immediately AFTER the `workingTasks` state declaration (around line 135) and the initial setWorkingTasks-from-project effect (around line 184). The new useEffect should run after `workingTasks` is initialized but before the persist callback definitions.

A reasonable anchor: place it right after the `rolledTasks` useMemo (around line 207).

Insert:

```ts
  // v2.3 wedge B — sub daily updates → master task.progress rollup.
  // Max-only guard: never decrease (a GC who set 80% locally shouldn't
  // see it drop because a sub said 60%). The SubUpdatesPanel shows the
  // underlying updates as the source of truth; this effect just keeps
  // the Gantt bar honest.
  //
  // workingTasks intentionally omitted from deps — running the effect on
  // workingTasks change would loop indefinitely (the patch IS a
  // workingTasks change). Same omit-deps precedent as v2.1's unmount-
  // flush useEffect — established pattern in this file.
  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    void (async () => {
      const subUpdates = await loadSubUpdates(project.id);
      if (cancelled || subUpdates.length === 0) return;
      // Latest update per task wins (highest progressPercent).
      const latestByTask = new Map<string, number>();
      for (const u of subUpdates) {
        const prev = latestByTask.get(u.taskId) ?? 0;
        if (u.progressPercent > prev) latestByTask.set(u.taskId, u.progressPercent);
      }
      setWorkingTasks(prev => {
        let mutated = false;
        const next = prev.map(t => {
          const rollup = latestByTask.get(t.id);
          if (rollup != null && rollup > (t.progress ?? 0)) {
            mutated = true;
            return { ...t, progress: rollup };
          }
          return t;
        });
        return mutated ? next : prev;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);
```

**Why this shape, not the spec's literal patches[] form:** the spec's `setWorkingTasks(prev => prev.map(...))` returns a new array every time, which would still cause a render even when no patches apply. The `mutated` flag short-circuits the common case (no sub updates higher than current). This matches the existing file's pattern of "only mutate when something actually changed." Functionally equivalent to the spec's max-only semantics.

- [ ] **Step 3.4: tsc gate**

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3.5: Grep assertions**

Run: `grep -nE "v2.3 wedge B|latestByTask|loadSubUpdates" app/schedule-pro.tsx`
Expected: at least 4 matches (1 marker comment + 1 latestByTask declaration + 1 import + at least 1 callsite).

Run: `git diff --stat HEAD -- app/schedule-pro.tsx`
Expected: 1 file changed.

- [ ] **Step 3.6: Manual reasoning — verify no infinite loop**

Read the new useEffect. Confirm:
- Deps array is `[project?.id]` only — does NOT include `workingTasks` or `setWorkingTasks`.
- The `mutated` flag ensures `setWorkingTasks` returns the same reference when no patches apply (no re-render triggered).
- `cancelled` flag protects against stale-state writes if the project ID changes mid-fetch.

- [ ] **Step 3.7: Commit**

```bash
git add app/schedule-pro.tsx
git commit -m "$(cat <<'EOF'
feat(schedule-pro): sub update → master task progress rollup (v2.3 wedge B)

When the GC opens schedule-pro, scan the project's SubScheduleUpdates from
AsyncStorage (via loadSubUpdates) and bump task.progress where any sub's
reported progressPercent exceeds the current master value. Max-only:
never decreases.

The SubUpdatesPanel already surfaces the underlying updates as the source
of truth; this effect just keeps the Gantt bar honest so a sub reporting
60% doesn't sit invisible while the master Gantt shows 0%.

workingTasks intentionally omitted from the useEffect deps — running on
workingTasks change would loop indefinitely (the patch IS a workingTasks
change). Same omit-deps precedent as v2.1 Task 2's unmount-flush effect.
The mutated flag short-circuits no-op renders so the effect is cheap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: C — Stale `linkedEstimateItems` telemetry

**Files:**
- Modify: `utils/scheduleEarnedValue.ts` (inside `buildEarnedValueSnapshot`'s task loop)

- [ ] **Step 4.1: Read the current task loop**

Run: `sed -n '100,115p' utils/scheduleEarnedValue.ts`
Expected: see the for-loop over tasks; the `items` derivation that maps `task.linkedEstimateItems` through `itemMap.get(id)` and filters with `(x): x is LinkedEstimateItem => !!x`.

- [ ] **Step 4.2: Add the `console.warn` inside the `.map(id => ...)` callback**

In `utils/scheduleEarnedValue.ts`, find this block (currently around lines 107-110):

```ts
    const items = (task.linkedEstimateItems ?? [])
      .map(id => itemMap.get(id))
      .filter((x): x is LinkedEstimateItem => !!x)
      .map(li => ({ id: li.materialId, description: li.name, carry: itemCarry(li) }));
```

Replace with:

```ts
    const items = (task.linkedEstimateItems ?? [])
      .map(id => {
        const item = itemMap.get(id);
        if (!item && task.linkedEstimateItems && task.linkedEstimateItems.length > 0) {
          // v2.3 wedge C: surface stale linkedEstimateItems so they don't
          // silently zero out task budgets. Active re-sync on estimate edit
          // is a separate sub-project — this is honest telemetry only.
          console.warn(
            `[scheduleEarnedValue] stale linkedEstimateItems id=${id} on task=${task.id} (${task.title}). Skipping.`
          );
        }
        return item;
      })
      .filter((x): x is LinkedEstimateItem => !!x)
      .map(li => ({ id: li.materialId, description: li.name, carry: itemCarry(li) }));
```

**Behavior change: zero.** Task budget still drops to 0 if the linked item is gone (existing math). New: a `console.warn` surfaces the cause, so a confused user has a breadcrumb.

The `task.linkedEstimateItems && task.linkedEstimateItems.length > 0` guard ensures we don't warn on tasks that legitimately have no linked items — only on tasks that DECLARE linked items but where one or more IDs miss the map.

- [ ] **Step 4.3: tsc gate**

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4.4: Grep assertion**

Run: `grep -nE "stale linkedEstimateItems" utils/scheduleEarnedValue.ts`
Expected: 1 match (the new console.warn template literal).

Run: `git diff --stat HEAD -- utils/scheduleEarnedValue.ts`
Expected: 1 file changed.

- [ ] **Step 4.5: Commit**

```bash
git add utils/scheduleEarnedValue.ts
git commit -m "$(cat <<'EOF'
feat(schedule-ev): warn on stale linkedEstimateItems (v2.3 wedge C)

When a task's linkedEstimateItems materialId can't be resolved against
the project's linkedEstimate (e.g., the item was deleted or recategorized
to a new materialId), log a console.warn surfacing the stale ID and the
task it lives on.

Behavior change: zero. Task budget still drops to 0 if the linked item is
gone (existing math). New: a warning breadcrumb so a confused user can
trace why their EV number dropped.

Active re-sync on estimate item edit (rewriting task.linkedEstimateItems
when items are deleted/recategorized) is a separate sub-project — touches
estimate edit screens and needs proper "tasks impacted" UX. v2.3 ships
telemetry only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: P1 — URL size guard for `shared-schedule` (atomic 2-file commit)

**Files:**
- Modify: `utils/scheduleOps.ts` (add `ShareTokenTooLargeError` class + `MAX_SHARE_TOKEN_LENGTH` constant + size check at the end of `encodeShareToken`)
- Modify: `app/schedule-pro.tsx` (wrap the `encodeShareToken` callsite at `:828` in try/catch with friendly Alert)

**Why one commit:** throwing without a catch would break sharing. The two changes must land together.

- [ ] **Step 5.1: Read the current `encodeShareToken` body**

Run: `sed -n '326,340p' utils/scheduleOps.ts`
Expected: see the existing `encodeShareToken` function (around lines 326-338).

- [ ] **Step 5.2: Read the current `handleShare` callsite in schedule-pro**

Run: `sed -n '820,850p' app/schedule-pro.tsx`
Expected: see the `handleShare` useCallback around line 820, with `encodeShareToken(payload)` at line 828 (currently un-wrapped).

- [ ] **Step 5.3: Add `ShareTokenTooLargeError` + size constant to `scheduleOps.ts`**

In `utils/scheduleOps.ts`, find the existing `encodeShareToken` function (around line 326). Immediately BEFORE it (so the class is exported above the consumer), insert:

```ts
/** Typed error thrown by `encodeShareToken` when the resulting URL-safe
 *  base64 token exceeds the Safari URL ceiling buffer. Callers should
 *  catch this and surface a friendly "schedule too large to share via
 *  link" message; the active Supabase-snapshot fallback is its own
 *  sub-project. */
export class ShareTokenTooLargeError extends Error {
  constructor(public tokenLength: number, public maxLength: number) {
    super(`Share token too large: ${tokenLength} > ${maxLength} chars`);
    this.name = 'ShareTokenTooLargeError';
  }
}

/** Safari URL ceiling buffer. Real limit varies by browser/proxy/referrer-
 *  header; 6000 chars is a safe headroom under the 8KB practical floor. */
const MAX_SHARE_TOKEN_LENGTH = 6000;
```

- [ ] **Step 5.4: Add the size check inside `encodeShareToken`**

In the same file, find the existing `encodeShareToken` function (currently lines 326-338):

```ts
export function encodeShareToken(payload: SharedSchedulePayload): string {
  const json = JSON.stringify(payload);
  // btoa only handles ASCII; use utf-8 round-trip.
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map(b => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  // Make URL-safe.
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

Modify the final `return` statement: extract the token into a local variable, run the size check, then return:

```ts
export function encodeShareToken(payload: SharedSchedulePayload): string {
  const json = JSON.stringify(payload);
  // btoa only handles ASCII; use utf-8 round-trip.
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map(b => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  // Make URL-safe.
  const token = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // v2.3 P1 — guard against silent URL-too-long failures. Throws a typed
  // error the caller can catch and surface a friendly alert.
  if (token.length > MAX_SHARE_TOKEN_LENGTH) {
    throw new ShareTokenTooLargeError(token.length, MAX_SHARE_TOKEN_LENGTH);
  }
  return token;
}
```

- [ ] **Step 5.5: Import `ShareTokenTooLargeError` in `app/schedule-pro.tsx`**

In `app/schedule-pro.tsx`, find the existing import line around `:76`:

```ts
import { encodeShareToken, buildSharePayload } from '@/utils/scheduleOps';
```

Extend it to also import the error class:

```ts
import {
  encodeShareToken, buildSharePayload, ShareTokenTooLargeError,
} from '@/utils/scheduleOps';
```

Or — if the file's import-listing pattern is single-line — keep it inline:

```ts
import { encodeShareToken, buildSharePayload, ShareTokenTooLargeError } from '@/utils/scheduleOps';
```

Match the file's existing style.

- [ ] **Step 5.6: Wrap the `encodeShareToken` callsite in try/catch**

In `app/schedule-pro.tsx`, find the `handleShare` useCallback (around lines 820-846). The current shape is:

```ts
  const handleShare = useCallback(() => {
    if (!project) return;
    const payload = buildSharePayload(
      project.name ?? 'Schedule',
      projectStartDate,
      workingTasks,
      { projectId: project.id },
    );
    const token = encodeShareToken(payload);
    let url = `/shared-schedule?t=${token}`;
    // ... rest of the body ...
```

Modify the `encodeShareToken` line and surrounding logic so the token derivation is inside a try/catch. Concretely, replace the line `const token = encodeShareToken(payload);` with:

```ts
    let token: string;
    try {
      token = encodeShareToken(payload);
    } catch (err) {
      if (err instanceof ShareTokenTooLargeError) {
        Alert.alert(
          'Schedule too large to share via link',
          `This schedule (${workingTasks.length} tasks) exceeds the URL size limit. Reduce the task count or use the sub-portal to share with subs.`
        );
        return;
      }
      throw err;
    }
    let url = `/shared-schedule?t=${token}`;
```

(The existing `let url = ...` line stays — the patch only changes the line above it.)

- [ ] **Step 5.7: tsc gate**

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5.8: Grep assertions**

Run: `grep -nE "ShareTokenTooLargeError" utils/scheduleOps.ts app/schedule-pro.tsx`
Expected: at least 4 matches across the two files (1 class declaration + 1 throw in scheduleOps; 1 import + 1 instanceof check in schedule-pro).

Run: `grep -nE "MAX_SHARE_TOKEN_LENGTH" utils/scheduleOps.ts`
Expected: 2 matches (1 const declaration + 1 comparison).

Run: `grep -nE "Schedule too large to share" app/schedule-pro.tsx`
Expected: 1 match (the Alert title).

Run: `git diff --stat HEAD -- utils/scheduleOps.ts app/schedule-pro.tsx`
Expected: 2 files changed.

- [ ] **Step 5.9: Commit**

```bash
git add utils/scheduleOps.ts app/schedule-pro.tsx
git commit -m "$(cat <<'EOF'
feat(schedule-share): URL size guard with typed error (v2.3 P1)

Adds ShareTokenTooLargeError class + MAX_SHARE_TOKEN_LENGTH (6000 chars,
safe headroom under Safari's 8KB URL ceiling) in utils/scheduleOps.ts.
encodeShareToken now throws the typed error when the resulting URL-safe
base64 exceeds the limit instead of producing a silently-broken link.

app/schedule-pro.tsx's handleShare wraps the encodeShareToken call in
try/catch, surfacing a friendly Alert: "This schedule (N tasks) exceeds
the URL size limit. Reduce the task count or use the sub-portal to share
with subs."

Two files, one commit — throwing without a catch would break sharing,
so the throw + catch must land atomically.

Active Supabase-snapshot fallback (a shared_schedule_snapshots table
mirroring sub_portal_snapshots, plus a token redirector) is explicitly
deferred — own sub-project once the friendly-error path starts seeing
real-world hits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final whole-impl gates (before opus review dispatch)

After Task 5 commits, run these gates from the worktree root.

- [ ] **Gate A: tsc clean repo-wide**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main"
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Gate B: scope ledger matches**

```bash
git diff --stat main..HEAD -- app/ utils/
```
Expected: exactly these 5 files (line counts approximate; what matters is the set):

```
 app/aia-pay-app.tsx           |  ~30 ++
 app/invoice.tsx               |  ~14 +-
 app/schedule-pro.tsx          |  ~50 ++
 utils/scheduleEarnedValue.ts  |  ~10 +-
 utils/scheduleOps.ts          |  ~20 ++
 5 files changed
```

No other file in `app/`, `utils/`, `components/`, `types/`, `hooks/`, `contexts/` may show up. The spec/plan docs in `docs/superpowers/` are already committed and not part of this gate.

- [ ] **Gate C: per-wire grep assertions**

```bash
# A1: invoice prefill uses legacyEvmMetrics
grep -nE "legacyEvmMetrics" app/invoice.tsx
# A2: aia-pay-app has the sync handler + button
grep -nE "handleSyncFromSchedule|Sync from schedule" app/aia-pay-app.tsx
# B: schedule-pro has the sub-update rollup
grep -nE "v2.3 wedge B|latestByTask|loadSubUpdates" app/schedule-pro.tsx
# C: scheduleEarnedValue warns on stale ids
grep -nE "stale linkedEstimateItems" utils/scheduleEarnedValue.ts
# P1: ShareTokenTooLargeError exists in both files
grep -nE "ShareTokenTooLargeError" utils/scheduleOps.ts app/schedule-pro.tsx
```

All five must return matches.

- [ ] **Gate D: spec coverage walk + non-touched files audit**

Open `docs/superpowers/specs/2026-05-20-v2-3-wedge-integrations-design.md` and verify §4.1 → Task 1, §4.2 → Task 2, §4.3 → Task 3, §4.4 → Task 4, §4.5 → Task 5. §4.6 (P2) is no-code-change — verify by running:

```bash
git diff main..HEAD -- 'app/(tabs)/schedule/index.tsx' hooks/useTierAccess.ts
```

Expected: empty output (no changes to either file). This confirms the deliberate "leave classic free" decision.

---

## Opus whole-impl review dispatch (after Gate D passes)

Dispatch one opus review with this scope:

1. Confirm the 5 commits + ledger from Gate B match the spec §8 exactly. No scope leak.
2. A1 prefill correctness — fallback to '30' when no schedule or no linked estimate; `legacyEvmMetrics` imported correctly.
3. A2 sync button — handler correctness, Alert paths for missing-data/zero-progress, Haptics.success on apply.
4. B rollup — max-only guard (never decreases), `latestByTask` Map populated correctly, omit-`workingTasks`-from-deps pattern justified, no infinite loops, `cancelled` flag prevents stale-state writes.
5. C `console.warn` — fires only when `itemMap.get` misses AND `task.linkedEstimateItems.length > 0` (quiet on tasks with no linked items).
6. P1 — `ShareTokenTooLargeError` class shape, `MAX_SHARE_TOKEN_LENGTH` constant value (6000), size check fires at the right spot, catch block surfaces friendly Alert with task count and sub-portal hint.
7. P2 — confirmed NO code change to `app/(tabs)/schedule/index.tsx` or `hooks/useTierAccess.ts` (deliberate non-action documented in spec §7).
8. tsc clean, no `any` introduced, no new dep in `package.json`.
9. Final verdict APPROVED / NEEDS-CHANGES with file:line evidence per check.

---

## Ship section — DEFERRED

Per the controller's directive ("netfly costs alot of tokens per OTA push so please be conservative and let us do everything before a push"), **no ship after v2.3**. The 5 commits sit on `claude/p0-launch-on-main` waiting for the batched OTA at the end of the session — combined with any subsequent sub-project work (e.g., v2.2 calendar-aware CPM if it happens in the same session, or polish items).

When the batched ship runs (controller-level decision, NOT this sub-project's responsibility):

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git checkout main
git pull origin main
git merge --ff-only claude/p0-launch-on-main
git push origin main
eas update --branch production --message "<batched description including v2.3 + whatever else>"
```

NO edge fn deploy (none changed). NO migration (none).
