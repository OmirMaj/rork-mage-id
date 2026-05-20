# v2.3 — Wedge Integrations — Design

Follow-up sub-project from the 2026-05-19 CPM audit. v2.1 made the schedule engine internally consistent; v2.3 wires three cross-domain data flows that the audit flagged as gaps (Gap A, B, C) plus two small polish cuts (P1, P2). v2.2 (calendar-aware CPM + backward-pass anchors) is its own sub-project for a later session.

Build target: p0-on-main worktree (`/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`), branch `claude/p0-launch-on-main` (== `main` @ `17c0c75`). **App + util-only, OTA-able. No migration, no edge fn, no portal, no new dependency** → Netlify-independent.

## 1. Reality check (vs the audit findings used as input)

The audit surfaced 9 bugs and 5 integration gaps. v2.1 took the 3 engine-truth bugs + 5 dead-code deletes + 1 type-shape cleanup. v2.3 takes:

- **Gap A** — Schedule → Invoice / AIA G702 progress-billing prefill. `app/invoice.tsx:237` defaults `progressPercent` to the literal `'30'`. `app/aia-pay-app.tsx` per-line input has no schedule signal. The AIA G702 wedge data path is ready — `scheduleEarnedValue.legacyEvmMetrics` produces cost-weighted `percentComplete` from `linkedEstimateItems` — but it's never read by either screen.
- **Gap B** — Sub update → master task progress. `app/shared-schedule.tsx:179` `handleUpdateSubmit` persists `SubScheduleUpdate` records but doesn't roll their `progressPercent` into `task.progress` on the GC's master. The SubUpdatesPanel shows updates but the Gantt bar stays at 0%.
- **Gap C** — Estimate → schedule re-sync. `autoScheduleFromEstimate:138-139` writes `linkedEstimateItems` (materialId array) onto tasks. When estimate items are deleted or recategorized (materialId changes), the task's reference goes stale. `buildEarnedValueSnapshot` silently filters out the missing item → task budget drops to 0 without surfacing.
- **P1** — `shared-schedule` URL is unbounded. `encodeShareToken` base64s the full task tree; ~200-task schedules blow past Safari's URL ceiling (~8KB). Currently fails silently or produces broken links.
- **P2** — Tier-gate gap on classic mobile schedule. `schedule-pro` is Pro-gated; `app/(tabs)/schedule/index.tsx` is open to free tier. Audit framed as "revenue leak"; we explicitly choose to **leave classic free** as the on-ramp.

Verified callsites:
- `app/invoice.tsx:237` — the `'30'` literal.
- `app/aia-pay-app.tsx` — `applyPercentToLine` callback already exists for per-line updates.
- `app/shared-schedule.tsx:179` — `handleUpdateSubmit` writes via `appendSubUpdate` only.
- `utils/scheduleEarnedValue.ts:88` — `buildEarnedValueSnapshot`'s `itemMap.get(id)` → `.filter((x): x is LinkedEstimateItem => !!x)` is the silent drop.
- `utils/scheduleOps.ts:326+` — `encodeShareToken` returns the base64 with no size check.
- `hooks/useTierAccess.ts` — `schedule_gantt_pdf` → Pro; `app/(tabs)/schedule/index.tsx` has no `canAccess` check.

`SavedAIAPayAppLine` (`types/index.ts:1116`) has NO `linkedTaskId` field — per-line task mapping is its own sub-project. v2.3's AIA fix is project-level only.

## 2. Problem

Three different "the schedule already knows this but nothing else asks" gaps:

1. **The AIA G702 wedge isn't wired.** Every billing cycle, a GC types a progress percent into a contract-line input. The schedule already knows the answer — `linkedEstimateItems` + `task.progress` resolves to a cost-weighted percentage that's far more defensible than a guessed number. The data path is ready; only the UI consumption is missing.
2. **Sub progress reports don't roll into the master schedule.** A sub on the shared link types "60% complete" into the daily update form. The GC sees that 60% in the SubUpdatesPanel — but the Gantt bar for that task still reads whatever the GC last set (often 0%). Two views of truth on the same task.
3. **Stale `linkedEstimateItems` silently zero out task budgets.** When the user recategorizes an estimate item (changes its CSI mapping → new materialId) or deletes an item, every task that referenced the old materialId loses its budget on the next render. No warning; no telemetry; the user just sees a smaller earned-value number.

Plus the URL guard (P1) — known to silently break on real-job-sized schedules — and the explicit policy decision on mobile tiering (P2).

## 3. Goal / Non-goals

**Goal:** Wire the three cross-domain flows the schedule already implies but never produces. Surface stale references instead of silently dropping budgets. Guard the share-URL size before it breaks. Document the mobile-tier policy.

**Non-goals (YAGNI / scope / honesty):**
- NOT calendar-aware CPM (audit bug #2) or backward-pass anchor honoring (#3) — those are v2.2.
- NOT per-AIA-line `linkedTaskId` mapping — `SavedAIAPayAppLine` has no such field today; adding it is a schema-shape change + per-line wire-up across the AIA pay app. Own sub-project once there's product demand.
- NOT active estimate→schedule re-sync on item edit. The data-cleanup story (when an item is deleted, scan tasks and drop the dead materialId) is more invasive — touches estimate edit screens, needs proper UX for "tasks impacted" review. v2.3 ships honest telemetry only.
- NOT active Supabase-snapshot fallback for oversized share URLs. The size guard throws a typed error and the caller surfaces a friendly alert; building a `shared_schedule_snapshots` table + redirector is its own sub-project.
- NOT applying tier gates to the classic mobile schedule. Explicit P2 decision: classic stays free as the marketing on-ramp.
- NOT changing the `subUpdates` storage model or the SubUpdatesPanel UI. Gap B rolls them into `task.progress` on the GC's side only.
- NO change to RevenueCat / tiers. No new entitlement keys.
- NO migration. NO edge fn. NO portal HTML change. NO new dep.

## 4. Architecture

### 4.1 A1 — Invoice `progressPercent` prefill

**File:** `app/invoice.tsx` (around line 237).

Replace the bare `'30'` literal with a schedule-derived value when both a schedule and a linked estimate are present. Fall back to `30` only when one of those is absent (so a fresh project still has a sane starting point).

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

**Import:** `import { legacyEvmMetrics } from '@/utils/scheduleEarnedValue';` near the existing imports in `app/invoice.tsx`.

**Why pass `[]` for invoices:** the EV snapshot's `AC` field needs invoices to compute CPI; for prefill we only need `percentComplete`, which is `EV/BAC` (AC-independent). Empty invoices gives `cpi = 1` (no harm). The actual invoice being created is excluded from its own prefill input — this is the right semantic.

### 4.2 A2 — AIA "Sync from schedule" button

**File:** `app/aia-pay-app.tsx`.

Add a `handleSyncFromSchedule` `useCallback` near the existing `applyPercentToLine` callback. The handler applies the project-level cost-weighted EV % to every AIA line.

```ts
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

**Import:** `import { legacyEvmMetrics } from '@/utils/scheduleEarnedValue';` if not already present.

**Button placement:** the implementer adds the trigger in the AIA pay app's header action area or per-line toolbar, matching the file's existing button conventions (`<TouchableOpacity>` with the existing button styles). The button label: "Sync from schedule".

**Per-line task mapping is explicitly out of scope.** `SavedAIAPayAppLine` (`types/index.ts:1116`) has no `linkedTaskId` field. Adding that field + per-line mapping is its own sub-project — v2.3 ships project-level sync only.

### 4.3 B — Sub update → master task progress rollup

**File:** `app/schedule-pro.tsx`.

Add a `useEffect` that watches `subUpdates` and bumps `task.progress` via `setWorkingTasks` when a sub's `progressPercent` exceeds the current master value. Max-only (never decreases). Silent — the SubUpdatesPanel already shows the underlying updates as the source of truth.

```ts
// v2.3 wedge B — sub daily updates → master task.progress rollup.
// Max-only guard: never decrease (a GC who set 80% locally shouldn't
// see it drop because a sub said 60%). The SubUpdatesPanel shows the
// underlying updates; this effect just keeps the Gantt bar honest.
useEffect(() => {
  if (!project || subUpdates.length === 0) return;
  const latestByTask = new Map<string, number>();
  for (const u of subUpdates) {
    const prev = latestByTask.get(u.taskId) ?? 0;
    if (u.progressPercent > prev) latestByTask.set(u.taskId, u.progressPercent);
  }
  // Compute the patch — only tasks where the rollup would actually increase.
  const patches: { id: string; progress: number }[] = [];
  for (const t of workingTasks) {
    const rollup = latestByTask.get(t.id);
    if (rollup != null && rollup > (t.progress ?? 0)) {
      patches.push({ id: t.id, progress: rollup });
    }
  }
  if (patches.length === 0) return;
  setWorkingTasks(prev =>
    prev.map(t => {
      const p = patches.find(x => x.id === t.id);
      return p ? { ...t, progress: p.progress } : t;
    })
  );
  // workingTasks intentionally omitted from deps — running the effect on
  // workingTasks change would loop indefinitely (the patch IS a
  // workingTasks change). Run only on subUpdates change + project change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [subUpdates, project?.id]);
```

**Implementer adapts at gate time:**
- Exact location of `subUpdates`, `workingTasks`, `setWorkingTasks` in `schedule-pro.tsx` (their definitions are already in scope — they're consumed by the existing SubUpdatesPanel + Gantt render path).
- The `eslint-disable-next-line` is the established pattern in this file for similar omit-deps cases (see the unmount-flush useEffect from v2.1 Task 2 for precedent).

### 4.4 C — Stale `linkedEstimateItems` telemetry

**File:** `utils/scheduleEarnedValue.ts`.

Inside `buildEarnedValueSnapshot` (the for-loop over tasks, where each task's `linkedEstimateItems` are mapped to actual items), add a `console.warn` when `itemMap.get(id)` returns undefined despite the task claiming to have linked items.

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

Behavior change: zero (task budget still drops to 0 if the linked item is gone — that's the existing math). New: a console warning surfaces the cause, so a confused user has a breadcrumb.

### 4.5 P1 — URL size guard for `shared-schedule`

**File:** `utils/scheduleOps.ts`.

Add a typed error class + size constant + size check at the end of `encodeShareToken`.

```ts
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

Modify `encodeShareToken` (existing body preserved):

```ts
export function encodeShareToken(payload: SharedSchedulePayload): string {
  const json = JSON.stringify(payload);
  // ... existing utf-8 + btoa encoding ...
  const token = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (token.length > MAX_SHARE_TOKEN_LENGTH) {
    throw new ShareTokenTooLargeError(token.length, MAX_SHARE_TOKEN_LENGTH);
  }
  return token;
}
```

**File:** `app/schedule-pro.tsx` — wrap the `encodeShareToken` callsite in try/catch.

```ts
try {
  const token = encodeShareToken(payload);
  // ... existing share logic ...
} catch (err) {
  if (err instanceof ShareTokenTooLargeError) {
    Alert.alert(
      'Schedule too large to share via link',
      `This schedule (${tasks.length} tasks) exceeds the URL size limit. Reduce the task count or use the sub-portal to share with subs.`
    );
    return;
  }
  throw err;
}
```

**Import:** `import { ShareTokenTooLargeError } from '@/utils/scheduleOps';` if not already imported.

Active Supabase-snapshot fallback is explicitly deferred — it'd need a `shared_schedule_snapshots` table mirroring `sub_portal_snapshots`, plus a token redirector in the static portal. Own sub-project once the friendly-error path starts seeing real-world hits.

### 4.6 P2 — Classic mobile schedule tier-gate

**No code change.** Explicit policy decision documented in §7: the classic mobile schedule (`app/(tabs)/schedule/index.tsx`) stays free as the marketing on-ramp. Pro tier unlocks Schedule Pro (Gantt + PDF + scenarios + baselines + AI risk + resource swimlanes). Mobile users get a functional schedule; the upsell is the productivity layer, not basic access.

This prevents the next audit from re-flagging the same "revenue leak" — the spec records the intent.

## 5. Error handling / correctness

- All five code-touching wires are pure additive — no existing behavior changes except where explicitly intended (A1 prefill default).
- A1 falls back to `'30'` when schedule or linked estimate is absent — zero regression for projects without that data.
- A2 alerts cleanly when schedule/estimate is missing or when % is 0; never crashes.
- B's max-only guard ensures `task.progress` never decreases via the rollup. If the GC manually sets 80% and a sub says 60%, the master stays at 80%.
- B's omit-`workingTasks`-from-deps is the established pattern for "fire on signal X, not on the field I'm about to change." `eslint-disable-next-line react-hooks/exhaustive-deps` matches the v2.1 Task 2 unmount-flush precedent.
- C's `console.warn` fires only when `itemMap.get(id)` misses AND the task has linked items declared. Quiet on tasks that legitimately have no linked items.
- P1's typed error is opt-in handling — callers that don't catch it will surface the throw to the global handler (acceptable — they should be catching). The schedule-pro caller catches and surfaces a friendly alert.
- Strict TS, no `any`. `npx tsc --noEmit` clean.

## 6. Verification (no unit runner)

Per-task gate: `npx tsc --noEmit` clean + per-task grep assertions (see §8 below).

Whole-impl manual checks (run before opus review):

1. **A1 prefill** — open a project with `schedule.tasks` + `linkedEstimate`. Tap "+ Invoice." The `progressPercent` field starts at the cost-weighted % from `legacyEvmMetrics`, not 30. Open a fresh project with no schedule → still defaults to 30.
2. **A2 sync** — open an AIA pay app on a project with schedule progress. Tap "Sync from schedule." Every line's `thisPeriod` updates to reflect the project-level EV %. Tap on a project without a schedule → friendly alert, no crash.
3. **B rollup** — open a shared sub link, submit an update with `progressPercent=60%` for task X. Open the GC's `schedule-pro` on the same project. Task X's progress bar reads ≥60% (never decreases). The SubUpdatesPanel still shows the underlying update.
4. **C telemetry** — recategorize an estimate item's materialId (or delete an item). Open the project's `schedule-pro`. The RN debugger console shows `[scheduleEarnedValue] stale linkedEstimateItems id=... on task=... (Title). Skipping.` Task EV is 0 for that task (existing math), but no longer silent.
5. **P1 size guard** — build a 250-task schedule. Tap "Share." Friendly alert appears: "Schedule too large to share via link..." No broken URL surfaces.

Final opus whole-impl review.

## 7. Out of scope / future

- **v2.2 — Calendar-aware CPM + backward-pass anchors.** The engine-deep fix. Preserved `utils/scheduleResourceCalendars.ts` from v2.1 is its waiting input.
- **Per-AIA-line `linkedTaskId` mapping.** Add the field to `SavedAIAPayAppLine`, wire per-line task selection, allow per-line EV-driven `thisPeriod` updates. Own sub-project once product demand surfaces.
- **Active estimate→schedule re-sync.** Hook into estimate item delete/edit, scan tasks, drop or remap stale materialIds. Requires UX for "tasks impacted" review. v2.3 ships telemetry only.
- **Active Supabase-snapshot fallback for oversized share URLs.** Create `shared_schedule_snapshots` table mirroring `sub_portal_snapshots`; token redirector in the static portal. v2.3 ships friendly-error path only.
- **Classic mobile schedule tier-gate.** Explicit decision: NOT gated. Classic mobile is the marketing on-ramp; Pro unlocks Schedule Pro features. Documented here so future audits don't re-flag.
- **Other audit polish queue** — `dependencies` vs `dependencyLinks` UI filter normalization (bug #8), `schedulePersist` debounce race (bug #7), `recalculateStartDays` + `runCpm` double-execution elimination (gap E), `runCpm({ levelResources: true })` UI surfacing or removal.

## 8. Touched-file ledger (locked scope)

| # | File | Wire | Change shape |
|---|---|---|---|
| 1 | `app/invoice.tsx` | A1 | Replace `progressPercent` `useState` initializer with prefill function; add `legacyEvmMetrics` import |
| 2 | `app/aia-pay-app.tsx` | A2 | Add `handleSyncFromSchedule` useCallback + UI trigger; add `legacyEvmMetrics` import |
| 3 | `app/schedule-pro.tsx` | B + P1 | Add sub-update rollup `useEffect`; wrap `encodeShareToken` callsite in try/catch for `ShareTokenTooLargeError`; add `ShareTokenTooLargeError` import |
| 4 | `utils/scheduleEarnedValue.ts` | C | Add `console.warn` in `buildEarnedValueSnapshot` for stale `linkedEstimateItems` |
| 5 | `utils/scheduleOps.ts` | P1 | Add `ShareTokenTooLargeError` class + `MAX_SHARE_TOKEN_LENGTH` constant + size check in `encodeShareToken` |

**5 files touched, 0 deleted, 0 created.** Sized like S1.3 / v2.1 Task 4. No migration, no edge fn, no portal, no new dep. P2 is documented in §7 only (no code change).
