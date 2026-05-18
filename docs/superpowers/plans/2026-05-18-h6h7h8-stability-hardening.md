# H6 / H7 / H8 — Stability Hardening Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the audit's H6 (schedule virtualization + bounded non-head-of-line offline queue + safe JSON parse), H7 (estimate-revision concurrency guard + pre-buyout snapshot), and H8 (financing edge-fn auth) without behavior regressions.

**Architecture:** Targeted, proportionate bug fixes. No new dependencies. H6/H7 are app-code (OTA-able). H8 is two edge functions (deployed at ship time, not build).

**Tech Stack:** React Native/Expo (RN `FlatList` already imported in the schedule screen), TypeScript strict, Deno edge functions, `crypto.subtle` HMAC. No unit runner — per-task gate = `npx tsc --noEmit` clean + the spec "Verification" manual check for that item.

**Spec:** `docs/superpowers/specs/2026-05-18-h6h7h8-stability-hardening-design.md` (@ 366b424). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

---

## CRITICAL: build authors code only

No migration apply, no edge-fn deploy, no OTA during the build. H6/H7 ship via OTA and H8 via `supabase functions deploy financing-callback financing-redirect --no-verify-jwt --project-ref nteoqhcswappxxjlpvap` — both are **ship-time controller steps after the final review**, NOT build steps. Per-task gate = `npx tsc --noEmit` clean + the named manual reasoning/check. Behavior-preservation: every change must keep existing flows working identically except for the specific hardening.

---

## File Structure

- Create `utils/safeJson.ts` — Task 1 (the shared safe-parse helper).
- Modify `app/bid-detail.tsx`, `app/invoice.tsx` (+ any genuinely-unguarded `JSON.parse` sites found) — Task 1.
- Modify `app/(tabs)/schedule/index.tsx` — Task 2 (FlatList virtualization of the primary long list + conditional Gantt mount).
- Modify `utils/offlineQueue.ts` — Task 3 (cap + concurrency).
- Modify `contexts/ProjectContext.tsx` (buyout/firm-price path) — Task 4. Uses existing `utils/estimateCommit.ts` helpers (no edit to estimateCommit).
- Modify `supabase/functions/financing-callback/index.ts`, `supabase/functions/financing-redirect/index.ts` — Task 5.

---

### Task 1: H6c — `safeJsonParse` helper + guard unguarded parses

**Files:**
- Create: `utils/safeJson.ts`
- Modify: `app/bid-detail.tsx` (~line 153), `app/invoice.tsx` (~line 167), + any genuinely-unguarded screen-level `JSON.parse` found in Step 3.

**Context:** The two audit-named sites are ALREADY wrapped in ad-hoc `try { JSON.parse(...) } catch`. So at those two, this is a behavior-equivalent consistency refactor; the real defect-hunting value is finding screen-level `JSON.parse` on stored/remote strings with NO guard.

- [ ] **Step 1: Create the helper**

Create `utils/safeJson.ts`:
```ts
/**
 * Parse JSON without throwing. Returns `fallback` on null/undefined/empty
 * input or any parse error. Use for stored (AsyncStorage) or remote/URL
 * strings at screen boundaries — never let a malformed blob crash a screen.
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 2: Refactor the two audit sites (behavior-equivalent)**

`app/bid-detail.tsx` — the `AsyncStorage.getItem(TRACKED_BIDS_KEY).then(data => { if (data) { try { const tracked = JSON.parse(data) as TrackedBid[]; const found = tracked.find(t => t.bidId === id); if (found) setTrackedBid(found); } catch { /* ignore */ } } })` block becomes:
```ts
AsyncStorage.getItem(TRACKED_BIDS_KEY).then(data => {
  const tracked = safeJsonParse<TrackedBid[]>(data, []);
  const found = tracked.find(t => t.bidId === id);
  if (found) setTrackedBid(found);
});
```
`app/invoice.tsx` — the `if (prefillLines) { try { const parsed = JSON.parse(prefillLines) as {...}[]; if (Array.isArray(parsed) && parsed.length > 0) { return parsed.map(...) ... } } catch ... }` — replace the `JSON.parse(prefillLines)` with `safeJsonParse<{ name?: string; description?: string; quantity?: number; unit?: string; unitPrice?: number }[]>(prefillLines, [])` and keep the existing `Array.isArray(parsed) && parsed.length > 0` guard + the rest of the body; drop the now-redundant surrounding try/catch only if it wrapped solely the parse (preserve any other logic it guarded). Add `import { safeJsonParse } from '@/utils/safeJson';` to both files.

- [ ] **Step 3: Sweep for genuinely-unguarded parses (the real fix)**

Run: `grep -rnE "JSON\.parse\(" app/ --include="*.tsx" --include="*.ts" | grep -viE "try|safeJsonParse"` and inspect each hit. For any that parses a stored/remote/URL string at a screen and is NOT inside a try/catch (a real crash risk), replace with `safeJsonParse(<raw>, <appropriate fallback matching current expected shape>)`. Do NOT touch parses of known-safe internal/constant strings, or ones already guarded. Proportionate — fix real unguarded boundary parses, don't churn the codebase. List each site changed in the report.

- [ ] **Step 4: Gate** — `npx tsc --noEmit` from worktree root → clean. Manual reasoning: feeding a malformed stored string to bid-detail/invoice now yields the fallback (`[]`) and the screen renders, not crashes.

- [ ] **Step 5: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add utils/safeJson.ts app/
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "fix(H6c): safeJsonParse helper + guard unguarded screen JSON.parse"
```

---

### Task 2: H6a — Schedule FlatList virtualization + conditional Gantt mount

**Files:**
- Modify: `app/(tabs)/schedule/index.tsx`

**Context:** 6 view modes (`'today' | 'lookahead' | 'board' | 'gantt' | 'resources' | 'summary'`). One list view already uses `<FlatList renderItem=...>` (~line 1191) — that is the pattern to mirror. Other views render via `.map()` in a `ScrollView`. `<GanttChart>` (`@/components/schedule/GanttChart`) and `<VerticalGantt>` are imported eagerly; `isVerticalGantt` state at ~:151.

- [ ] **Step 1: Locate the primary long list + the Gantt mount**

Read `app/(tabs)/schedule/index.tsx`. Identify (a) the view that renders the **full unbounded task list** via `.map()` inside a `ScrollView` (the lookahead/phase or today list — the one whose array is the full schedule task set, not a small bounded set like milestones/critical-path/risk-items/crews), and (b) where `<GanttChart>`/`<VerticalGantt>` are rendered and under what condition (the `view`/active-mode value, e.g. `=== 'gantt'`).

- [ ] **Step 2: Virtualize the primary long list**

Convert that one large `.map()`-in-`ScrollView` render into a `<FlatList>` mirroring the existing FlatList at ~:1191: `data={<sameArray>}`, `keyExtractor`, `renderItem={({ item: task }) => ( <sameJSXAsTheMapBody> )}`, preserving the exact item JSX, props, handlers, and styles. Keep the section header/controls (the non-list chrome) outside the FlatList (use `ListHeaderComponent` if they scrolled with the list). Do NOT convert the small bounded `.map` lists (crews, milestones, critical tasks, risk items, phase chips) — they are small-N and converting them risks layout regressions for no virtualization benefit (YAGNI, explicitly out of scope).

- [ ] **Step 3: Conditionally mount the Gantt**

Ensure `<GanttChart>`/`<VerticalGantt>` render ONLY when the active view is the Gantt view (e.g. `{view === 'gantt' && (isVerticalGantt ? <VerticalGantt .../> : <GanttChart .../>)}`). If they are currently rendered eagerly/behind a hidden container, gate them on the view condition so the heavy subtree + its effects/forecast wiring don't mount on the list views. Preserve the list↔Gantt toggle, scenario/what-if wiring, weather/forecast props, and all existing behavior exactly — only the *mount condition* changes.

- [ ] **Step 4: Gate** — `npx tsc --noEmit` clean. Manual (reason through, and run `bun run start` if feasible): the long task list scrolls (virtualized); switching to the Gantt view mounts the Gantt and back to a list view unmounts it; scenarios/what-if and the toggle behave exactly as before; no missing rows/keys.

- [ ] **Step 5: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add "app/(tabs)/schedule/index.tsx"
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "perf(H6a): virtualize schedule list via FlatList + conditional Gantt mount"
```

---

### Task 3: H6b — Bounded, non-head-of-line offline queue

**Files:**
- Modify: `utils/offlineQueue.ts`

**Context:** `addToOfflineQueue` does `queue.push(entry)` with NO cap (the definite bug — unbounded AsyncStorage growth on a stuck client). `processOfflineQueue` ALREADY iterates the whole queue and continues past failures (terminal→discard via `isTerminalError`, non-terminal→`retryCount++`, `< MAX_RETRIES`→`remaining`), but does so strictly sequentially (`for (const mutation of sorted) { await ... }`).

- [ ] **Step 1: Cap the queue (the real bug)**

In `addToOfflineQueue`, after `const queue = await getOfflineQueue();` and building `entry`, before persisting:
```ts
const MAX_QUEUE = 1000;
queue.push(entry);
if (queue.length > MAX_QUEUE) {
  const dropped = queue.length - MAX_QUEUE;
  queue.splice(0, dropped); // FIFO: drop oldest
  console.warn(`[OfflineQueue] cap ${MAX_QUEUE} exceeded — dropped ${dropped} oldest mutation(s)`);
}
await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
```
(Add `MAX_QUEUE` as a module const next to `MAX_RETRIES` rather than inline if cleaner — keep one definition.)

- [ ] **Step 2: Bounded-concurrency flush preserving per-record order**

In `processOfflineQueue`, replace the strictly-serial `for (const mutation of sorted) { ... }` with grouped bounded concurrency:
- Group `sorted` by record key `` `${mutation.table}:${String(mutation.data?.id ?? mutation.id)}` `` (insert with no `data.id` → its own unique singleton group via the entry `id`). Within a group, process **serially in timestamp order** (preserves insert-before-update etc.). Across groups, process with bounded concurrency (max 5 groups in flight) via a simple pool over `Promise.allSettled`.
- The per-mutation handling inside (insert/update/delete branch, `error` check, `isTerminalError`→discard+`failed++`, else `retryCount++`; `>= MAX_RETRIES`→`failed++` else push to `remaining`) stays semantically identical — only the iteration becomes grouped+concurrent. Aggregate `processed`/`failed`/`remaining` across groups (use thread-safe accumulation: each group returns its own counts/remaining, reduce at the end). Persist `remaining` and return totals exactly as today.

**Documented fallback (spec-authorized):** if safe grouping proves non-trivial under the actual data shapes (e.g. ambiguous record id across operations), DO NOT risk reordering — keep the existing serial loop (it already continues past failures, so head-of-line abort is not actually present) and ship ONLY Step 1's cap. Record in the report that concurrency was deferred and why. The unbounded-queue cap is the required fix; concurrency is the optional enhancement.

- [ ] **Step 3: Gate** — `npx tsc --noEmit` clean. Manual reasoning: enqueue past 1000 → length stays ≤1000, oldest dropped, warning logged; a persistently-failing entry still lets other entries process (already true) and now does not serialize-block throughput across distinct records; two mutations to the same `table:id` still apply in timestamp order.

- [ ] **Step 4: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add utils/offlineQueue.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "fix(H6b): cap offline queue (FIFO 1000) + grouped non-blocking flush"
```

---

### Task 4: H7 — Pre-buyout estimate snapshot + no stale-revision clobber

**Files:**
- Modify: `contexts/ProjectContext.tsx` (the buyout / firm-price estimate write path)

**Context:** `utils/estimateCommit.ts` exports `snapshotPatch(current: LinkedEstimate, reason: EstimateChangeReason, note?, createdBy?) => { estimateVersions }` and `commitEstimatePatch(...)`; both APPEND to `project?.estimateVersions ?? []` then `applyCap` — they never clobber. The bug: the buyout allowance→firm-price path mutates the estimate and upserts the projects row WITHOUT routing through these append-helpers, so a stale in-memory `estimateVersions` can overwrite the authoritative array and no revision is recorded. H5 preserved this logic verbatim at shifted line numbers.

- [ ] **Step 1: Locate the buyout/firm-price estimate write**

`grep -nE "firmPriced|firm_priced|isAllowance|buyout|awardBidPackage|estimateVersions|linkedEstimate" contexts/ProjectContext.tsx` and read the `awardBidPackage` / buyout path that converts an allowance line to a firm price and writes the estimate/projects row. Identify exactly where it sets `linkedEstimate`/`estimateVersions` and the `updateProject`/projects upsert it triggers.

- [ ] **Step 2: Snapshot before the in-place buyout edit**

Immediately before the buyout mutates the estimate in place, capture the current estimate and append a revision via the existing helper — do not hand-roll:
```ts
import { snapshotPatch } from '@/utils/estimateCommit';
// ...at the buyout site, where `project` is the fresh project and it has a linkedEstimate:
const preBuyout = project.linkedEstimate
  ? snapshotPatch(project.linkedEstimate, 'pre_overwrite', 'pre-buyout snapshot')
  : null;
```
Merge `preBuyout?.estimateVersions` into the same `updateProject(project.id, { ... })` patch that applies the buyout (so the revision is recorded atomically with the buyout, before/with the overwrite). If `snapshotPatch` is already imported in the file, reuse the import.

- [ ] **Step 3: Eliminate the stale-clobber**

Ensure the buyout's projects write computes `estimateVersions` from the **fresh** project state (the same `project?.estimateVersions ?? []` base the commit helpers use) and never sends an `estimateVersions` array captured from a stale closure. Prefer routing the buyout estimate change through `commitEstimatePatch`/`snapshotPatch` (which append to current) rather than assigning a recomputed-from-stale array. **Invariant (must hold):** after a buyout, the revision array length is `>=` its pre-buyout length (history never shrinks) AND exactly one new pre-buyout revision exists. If `projects.updated_at` optimistic guarding is cleanly available on the upsert path, add it as defense-in-depth; if not, the fresh-merge above is the guard — do not invent a new column in this batch (would make it non-OTA).

- [ ] **Step 4: Gate** — `npx tsc --noEmit` clean. Manual: on a project with N existing revisions, perform a buyout/firm-price → revisions count is N+1 (a `pre_overwrite` revision added), history not shortened, estimate total reflects the firm price; doing it again adds another revision (no clobber).

- [ ] **Step 5: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add contexts/ProjectContext.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "fix(H7): snapshot estimate before buyout + prevent stale revision-array clobber"
```

---

### Task 5: H8 — Financing edge-fn authentication (authored only; deploy at ship time)

**Files:**
- Modify: `supabase/functions/financing-callback/index.ts`, `supabase/functions/financing-redirect/index.ts`

**Context:** Both are anon, unauthenticated, service-role. `financing-callback` is GET/POST `?ref=&status=`, **never errors** (always 302 to thankyou — that UX must be preserved). The poisoning vector is the DB status mutation, not the redirect. Financing is dormant → fail-closed is correct.

- [ ] **Step 1: Add an HMAC verifier (shared, inline per fn — Deno, no shared import infra)**

In `financing-callback/index.ts`, add near the top:
```ts
const FINANCING_CALLBACK_SECRET = Deno.env.get("FINANCING_CALLBACK_SECRET") || "";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function validSignature(req: Request, signedPayload: string): Promise<boolean> {
  if (!FINANCING_CALLBACK_SECRET) return false; // fail closed (financing dormant)
  const provided = req.headers.get("x-financing-signature") || "";
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(FINANCING_CALLBACK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, provided.toLowerCase());
}
```

- [ ] **Step 2: Gate ONLY the DB mutation in financing-callback (preserve the never-error redirect UX)**

In the handler, compute the signed payload as the canonical `` `${ref}:${next}` `` (ref + resolved status). Before the `if (shouldUpdate) { await db...update(...) }` block, require a valid signature; if invalid/missing/secret-unset, SKIP the DB update but STILL `return redirect(THANKYOU_URL)` (no error surfaced — identical UX, but referral status is not advanced by an unauthenticated/forged call):
```ts
const authed = await validSignature(req, `${ref}:${next}`);
if (shouldUpdate && authed) {
  await db.from("financing_referrals").update({ status: next, updated_at: new Date().toISOString() }).eq("id", ref);
}
return redirect(THANKYOU_URL);
```
(Keep the existing unknown-token → redirect, ranked-state logic unchanged; only the mutation is now gated by `authed`.)

- [ ] **Step 3: financing-redirect — require portal token (portal mode) else HMAC**

In `financing-redirect/index.ts`, add the same `FINANCING_CALLBACK_SECRET`/`timingSafeEqual`/`validSignature` helper. For the `projectParam && srcParam === "portal"` branch (portal-initiated find-or-create): require the portal bearer token the portal already sends (the `Authorization: Bearer <anon/portal key>` header used by the portal surface — verify it is present and non-trivial, mirroring `_shared/auth.ts`'s apikey sanity check; the portal legitimately has it). For the partner `ref` branch: require `validSignature(req, ref)`. On failure of the applicable check: `return redirect(FALLBACK_URL)` WITHOUT creating/advancing the referral row (preserve the safe redirect; just don't perform the privileged find-or-create/status write). Leave all existing redirect/fallback behavior otherwise intact.

- [ ] **Step 4: Gate** — `npx tsc --noEmit` clean (edge fns are Deno but the repo tsc must still pass; do not break repo types). Static reasoning: with no/invalid `X-Financing-Signature` (or unset secret) the DB mutation/find-or-create is skipped but the user still gets the 302; with a valid HMAC the status advances. **Do NOT deploy.**

- [ ] **Step 5: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add supabase/functions/financing-callback/index.ts supabase/functions/financing-redirect/index.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "fix(H8): HMAC/portal-token gate financing edge-fn DB mutations (fail-closed; financing dormant)"
```

---

## Ship-time controller steps (after final whole-impl review — NOT build)

1. FF-merge `claude/p0-launch-on-main` → `main`, push.
2. `eas update --branch production --message "H6/H7 stability hardening"` (H6+H7 are app code).
3. Set the `FINANCING_CALLBACK_SECRET` edge-fn env var (controller/user — financing dormant so any sufficiently-random secret is fine until partners are onboarded), then `supabase functions deploy financing-callback financing-redirect --no-verify-jwt --project-ref nteoqhcswappxxjlpvap`.
   (Independent of H4's Netlify-blocked cutover.)

---

## Self-Review

**Spec coverage:** H6a→Task 2, H6b→Task 3, H6c→Task 1, H7→Task 4, H8→Task 5. Spec "Verification" per-item → each task's gate. Spec scope/sequencing order followed (H6c→H6a→H6b→H7→H8). Spec non-goals respected (no FlashList, no React.lazy, no estimate_versions-table migration, no exhaustive parse audit, documented concurrency fallback, H8 minimal/fail-closed). No gaps.

**Placeholder scan:** New/small code (safeJson, queue cap, HMAC verifier, snapshot call) given in full. Task 2 & Task 4 use "locate via grep then apply transformation X preserving invariant Y" with the anchor facts (existing FlatList@~1191 to mirror; `snapshotPatch` signature/append-semantics) — these are in-situ adaptive edits in large files (schedule screen, post-H5 ProjectContext) where reproducing the whole region in the plan is counter-productive; the transformation + invariant are precise, not vague. No "handle appropriately" placeholders; the one deferral (Task 3 concurrency) is an explicit spec-authorized fallback with a fixed required-minimum (the cap).

**Type/name consistency:** `safeJsonParse<T>(raw, fallback)` signature identical in helper + both call sites. `MAX_QUEUE=1000` single const. `validSignature(req, signedPayload)`/`timingSafeEqual` identical across both financing fns. `snapshotPatch(current, 'pre_overwrite', note?)` matches `utils/estimateCommit.ts`'s real export. `EstimateChangeReason` value `'pre_overwrite'` is a real member (used as the default in `commitEstimatePatch`). View-mode literal `'gantt'` matches the `ScheduleViewMode` union.
