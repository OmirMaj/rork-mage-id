# Live Schedule Collaboration — Phase 2 (Live Sync + Presence) Implementation Plan

> Executes the Phase 2 section of `docs/superpowers/specs/2026-07-28-live-schedule-collaboration-design.md`.

**Goal:** On the web schedule (`schedule-pro`), a collaborator's edits appear live for everyone, and everyone sees who's here + which task each person is editing — without a heavy convergence engine (that stays Phase 3).

**Architecture:** Add `projects` to the Supabase Realtime publication. A per-project **Presence** channel tracks `{userId, name, color, selectedTaskId}`. A live-sync layer subscribes to the project row; on a peer's persisted change it **merges task-by-task**, preserving only the task the local user currently has selected (presence-driven), then re-runs CPM. Saves ignore the local user's own realtime echo. Presence drives avatars + a soft lock on tasks others are editing — which is what actually prevents same-task collisions.

**Tech Stack:** Supabase Realtime (`postgres_changes` + Presence/`.track()`), Expo Router, RN Web, `@nkzw/create-context-hook`, existing CPM (`utils/cpm.ts`).

**Key decision:** merge preserves only the LOCAL user's selected task; everything else takes the peer's version. Presence prevents two people selecting the same task, so this simple rule converges correctly in practice. True per-task CRDT is Phase 3, build-only-if-needed.

---

## File Structure

**Create:**
- `supabase/migrations/20260729120000_realtime_projects.sql` — add `projects` to the `supabase_realtime` publication.
- `utils/scheduleMerge.ts` — pure `mergeScheduleTasks(local, incoming, protectedTaskId)` (unit-tested).
- `scripts/validate-schedule-live-merge.ts` — merge tests (added to ship-check).
- `hooks/useSchedulePresence.ts` — Presence channel: track self + return peers.
- `hooks/useLiveSchedule.ts` — realtime subscription to the project row + echo-suppression + merge callback.
- `components/schedule/PresenceBar.tsx` — collaborator avatars.

**Modify:**
- `app/schedule-pro.tsx` — wire live-sync + presence; render `PresenceBar`; set selected task into presence; soft-lock peers' tasks.
- `package.json` — add `test:schedule-live-merge` to ship-check.

---

## Task 1: Pure merge function (the crux)

**Files:** Create `utils/scheduleMerge.ts`, `scripts/validate-schedule-live-merge.ts`.

- [ ] **Step 1: Write the failing test** (`scripts/validate-schedule-live-merge.ts`): incoming wins for non-protected tasks; the protected task keeps the local version; a peer-added task appears; a peer-deleted task is dropped (unless it's the protected/local-only one); order follows incoming with local-only appended.

- [ ] **Step 2: Implement `mergeScheduleTasks`:**

```ts
import type { ScheduleTask } from '@/types';

/**
 * Merge an incoming (peer-persisted) task list into the local working copy,
 * preserving ONLY the task the local user currently has selected/is editing
 * (`protectedTaskId`, from presence). Everything else takes the incoming value.
 * Presence guarantees two users don't hold the same task, so this converges.
 *
 * - non-protected id in incoming → incoming version
 * - protectedTaskId → local version (kept) if it exists locally, else incoming
 * - local-only task that is the protected one → kept (a not-yet-saved add)
 * - task missing from incoming and NOT protected → dropped (peer deleted it)
 */
export function mergeScheduleTasks(
  local: ScheduleTask[],
  incoming: ScheduleTask[],
  protectedTaskId: string | null,
): ScheduleTask[] {
  const localById = new Map(local.map((t) => [t.id, t]));
  const merged = incoming.map((t) =>
    t.id === protectedTaskId && localById.has(t.id) ? (localById.get(t.id) as ScheduleTask) : t,
  );
  // Keep a not-yet-persisted local-only task only if it's the protected one.
  if (protectedTaskId && localById.has(protectedTaskId) && !incoming.some((t) => t.id === protectedTaskId)) {
    merged.push(localById.get(protectedTaskId) as ScheduleTask);
  }
  return merged;
}
```

- [ ] **Step 3: Run** `bun run scripts/validate-schedule-live-merge.ts` → all pass.
- [ ] **Step 4:** Add `"test:schedule-live-merge"` to `package.json` + the ship-check chain. Commit checkpoint.

---

## Task 2: Realtime on `projects` (prod change — checkpoint first)

**Files:** Create `supabase/migrations/20260729120000_realtime_projects.sql`.

- [ ] **Step 1: Migration:** `alter publication supabase_realtime add table public.projects;` (idempotent guard: check `pg_publication_tables` first, or wrap in a DO block that ignores "already member").
- [ ] **Step 2:** Apply to prod via Supabase MCP `apply_migration` (collaborators already get the whole row by design, so no new field-leak). Verify `projects` is now in `pg_publication_tables`.

---

## Task 3: Presence hook

**Files:** Create `hooks/useSchedulePresence.ts`.

- [ ] **Step 1:** `useSchedulePresence(projectId, self)` — `supabase.channel('schedule:'+projectId, { config: { presence: { key: self.userId } } })`; `.on('presence', { event: 'sync' }, …)` to build the peers list; `.track({ userId, name, color, selectedTaskId })` on subscribe; expose `peers` + `setSelectedTask(id)` (re-`track` with the new selectedTaskId). Clean up on unmount. Assign a stable per-user color from the userId hash.

---

## Task 4: Live-sync hook (echo-suppressed)

**Files:** Create `hooks/useLiveSchedule.ts`.

- [ ] **Step 1:** `useLiveSchedule(projectId, { onPeerSchedule })` — subscribe `postgres_changes` UPDATE on `projects` filtered `id=eq.{projectId}`. On event, read `payload.new.schedule`; **suppress the local user's own echo** by comparing `payload.new.updated_at` (or a client-set `schedule_rev` nonce) against the last value this client wrote; if it's a peer change, call `onPeerSchedule(incomingTasks)`. schedule-pro's `onPeerSchedule` runs `mergeScheduleTasks(workingTasks, incoming, mySelectedTaskId)` → setWorkingTasks → CPM re-runs via the existing memo.

---

## Task 5: schedule-pro integration + PresenceBar

**Files:** Create `components/schedule/PresenceBar.tsx`; modify `app/schedule-pro.tsx`.

- [ ] **Step 1:** In `schedule-pro`, call `useSchedulePresence` + `useLiveSchedule`. Track the selected task into presence when the user selects/drags a bar. Render `<PresenceBar peers={peers} />` in the header. Soft-highlight/lock any task another peer has `selectedTaskId` on (dim + a small avatar chip on the bar; block drag on a peer-held task). Wire `onPeerSchedule` → merge.
- [ ] **Step 2:** Manual multi-window web test (two browser sessions, owner + editor): edits appear live; avatars show; the task someone's editing is locked for the other.

---

## Task 6: Verify + ship

- [ ] `bun run ship-check` green. OTA to production. Confirm realtime on `projects` is live (a change in one window appears in another).

---

## Self-Review
- Live sync (spec 2.1) → Tasks 2, 4 (+ merge Task 1). Presence (spec 2.2) → Tasks 3, 5. Convergence rule (presence-protected merge) → Task 1, consistent across 4 + 5. Echo-suppression called out (Task 4). Per-task table stays Phase 3 (not here).
