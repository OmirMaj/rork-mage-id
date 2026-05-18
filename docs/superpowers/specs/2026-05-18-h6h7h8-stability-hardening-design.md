# H6 / H7 / H8 — Stability Hardening Batch — Design

Source: `docs/superpowers/audits/2026-05-17-prebroad-testflight-hardening-audit.md` items **H6, H7, H8**.
Pre-broad-TestFlight stability pass. Audit-derived bug fixes (the audit is effectively the spec; like the P0 H1/H2/H3 batch). Proportionate — only the real decisions are recorded.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`, HEAD `e09c2a7`. H6/H7 are code-only (OTA-able). H8 requires an edge-fn redeploy. H4 is separately blocked on an external Netlify deploy (already surfaced; independent of this batch).

## H6 — Schedule virtualization + offline-queue bounding + safe JSON parse

### H6a — Schedule list virtualization + lazy Gantt

`app/(tabs)/schedule/index.tsx` renders large task lists via `.map()` inside a `ScrollView`, and mounts the heavy `GanttChart`/`VerticalGantt` component trees eagerly even when the list view is showing.

**Decision (no new dependency):** the file already imports React Native `FlatList`. Virtualize the long task list(s) with `FlatList` (windowed rendering) — do NOT add FlashList or any list lib (YAGNI). For the Gantt: **conditionally mount** — render `<GanttChart>`/`<VerticalGantt>` only when the Gantt view is the active view, not eagerly behind a hidden tab. (Not `React.lazy` — RN/Hermes ships one bundle so lazy doesn't reduce parse cost; the real win is not mounting the heavy subtree/its effects/forecast wiring when the list view is shown. Conditional mount is simpler and sufficient.) Preserve all existing schedule behavior, scenario/what-if wiring, and the list↔Gantt toggle exactly.

### H6b — Offline queue: bounded + non-head-of-line

`utils/offlineQueue.ts` `enqueue` does `queue.push(entry)` with no size bound; the flush is strictly sequential so a persistently-failing head entry starves everything behind it (head-of-line blocking). `MAX_RETRIES=5` already exists.

**Decisions:**
- **Cap:** `MAX_QUEUE = 1000`. On enqueue, if the queue is at the cap, drop the **oldest** entry and `console.warn` (FIFO eviction). 1000 is far above any normal user's offline backlog; the bug being fixed is *pathological unbounded growth* on a permanently-offline or perpetually-erroring client bloating AsyncStorage — not normal operation. (Drop-oldest, not reject-newest: the newest write is the user's most recent intent; a 1000-deep backlog already implies the oldest are stale.)
- **Non-head-of-line flush:** the flush iterates the **whole** queue; a non-terminal failure on one entry increments its retry count and continues to the next entry (the failing entry stays queued for its next flush, up to `MAX_RETRIES`, then is dropped — terminal auth/permission errors already drop immediately per the existing `isTerminal` logic). Use bounded concurrency (process in small chunks, e.g. 5 at a time, via `Promise.allSettled`) rather than strictly serial. Preserve idempotency/ordering semantics where a later entry depends on an earlier one for the SAME record: keep per-record ordering by only parallelizing across distinct `table`+`id` targets (group by target, serial within a group, parallel across groups). If that grouping is non-trivial to do safely, fall back to serial-but-skip-past-failing-head (still fixes head-of-line) and document the concurrency deferral.

### H6c — Safe JSON parse helper

`app/bid-detail.tsx:153` and `app/invoice.tsx:167` call `JSON.parse` on stored/remote strings with no guard → a malformed value crashes the screen.

**Decision:** add `utils/safeJson.ts` `export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T` (try/parse/catch→fallback, no throw). Replace the two unguarded `JSON.parse` call sites with it. Grep for other obviously-unguarded screen-level `JSON.parse` on external/stored data and convert opportunistically **only if trivially safe** (same fallback semantics); do not chase every parse in the codebase (proportionate — the two audit sites are the requirement).

## H7 — Estimate-revision concurrency guard + snapshot before buyout

Estimate revisions are persisted only inside the `projects.estimateVersions` JSONB column (read `contexts/ProjectContext.tsx:326`, written via the projects upsert ~`:1148`; mutated through `utils/estimateCommit.ts`). A dedicated `estimate_versions` table + RLS exists (`supabase/migrations/20260517120000_estimate_versions.sql`, `est_versions_*` policies) but the live revision path still uses the JSONB blob. The buyout allowance→firm-price path (the `awardBidPackage`/buyout in-place edit in `contexts/ProjectContext.tsx` — **post-H5 the body is verbatim-preserved but line numbers shifted; grep for the buyout/firm-price estimate write, do not trust old line numbers**) upserts the whole projects row: a stale in-memory `estimateVersions` overwrites the authoritative array (silent history loss), and the buyout in-place edit appends **no** revision (audit-trail gap).

**Decision — Option A (targeted guard + snapshot), the audit's primary suggestion.** Rejected Option B (migrate the revision store to the dedicated `estimate_versions` table): architecturally cleaner and fully removes the clobber vector, but it is a broad data-path migration + backfill of existing JSONB revisions + offline-queue/sync changes — disproportionate and risky for a stability batch. Logged as future work (the dedicated table can be adopted in its own effort).

Option A, two parts:
1. **Snapshot before the buyout in-place edit.** Immediately before the buyout mutates the estimate in place, append a revision via the existing `utils/estimateCommit.ts` snapshot helper (the same mechanism used elsewhere — reason code for a pre-buyout snapshot, e.g. `'pre_overwrite'`), so the pre-buyout state is recoverable and the audit trail is complete.
2. **Optimistic-concurrency guard on the projects upsert.** The buyout/firm-price write must not blind-overwrite `estimate_versions` from a possibly-stale closure. Guard the projects upsert with an `updated_at` precondition (only write if the row's `updated_at` is the one we loaded; on mismatch, re-read and re-apply the buyout delta onto fresh state rather than clobbering). If `projects.updated_at` is not already maintained, the guard is implemented app-side by recomputing the revisions array from freshly-read project state at write time (never sending a stale full `estimateVersions` array). The exact mechanism (server `updated_at` condition vs app-side fresh-merge) is finalized in the plan against the actual post-H5 code; the **invariant** is fixed here: *the buyout write can never reduce/replace the revision history with a stale copy, and always records a revision.*

OTA-able (app logic; no schema change required for Option A — if an additive `updated_at` default-now column is needed it is additive/idempotent).

## H8 — Financing edge-fn authentication (minimal; financing dormant)

`supabase/functions/financing-redirect` and `financing-callback` are fully unauthenticated → at scale, replaying ids inflates referral/payout-attribution analytics. Bounded: no data leak, no open-redirect. **Financing is dormant** (user deprioritized it: "keep it dormant for now"), so real current exposure is ~nil; this is defensive hardening for whenever financing activates — keep it minimal.

**Decision — shared-secret/HMAC via env, no new infra:**
- `financing-callback` (partner→us): require an HMAC signature header (`X-Financing-Signature`) computed over the raw request body with a shared secret from a new edge-fn env var `FINANCING_CALLBACK_SECRET`. Constant-time compare (reuse the `validate-portal-passcode` constant-time pattern). Reject (401) on missing/invalid signature. If the env var is unset, fail closed (reject) — financing is dormant so failing closed is correct and safe.
- `financing-redirect` portal mode: require the portal bearer token already used by the portal surface for the portal-initiated branch; non-portal/partner branches require the same `FINANCING_CALLBACK_SECRET` HMAC or are rejected. Preserve the existing (bounded, safe) redirect behavior for authenticated calls.
- Redeploy both with `--no-verify-jwt --project-ref nteoqhcswappxxjlpvap` (anon-invoked; the `--no-verify-jwt` lesson from the prior financing build).

## Verification (no unit runner)

`npx tsc --noEmit` clean repo-wide + manual walkthrough per item:
- **H6a:** schedule screen scrolls a long task list smoothly; list↔Gantt toggle works; Gantt only mounts when its view is selected; scenarios/what-if unchanged.
- **H6b:** enqueue past the cap drops oldest with a warning and the queue length stays ≤ cap; a deliberately-failing entry does not block subsequent entries from flushing; per-record ordering preserved.
- **H6c:** feeding a malformed stored string to the two screens shows the fallback, not a crash.
- **H7:** perform a buyout/firm-price on a project with existing revisions → revision history is NOT shortened, a pre-buyout revision now exists, and a concurrent/stale write cannot silently drop history (forced-stale test).
- **H8:** `curl` financing-callback without/with a bad signature → 401; with a valid HMAC → accepted; financing-redirect portal mode without the portal token → rejected.
- Final whole-impl review (opus).

## Scope / sequencing

One spec, one plan. Suggested task order: H6c (safe-parse, trivial, isolated) → H6a (schedule) → H6b (offline queue) → H7 (estimate guard) → H8 (financing edge fns, last — needs deploy). H6/H7 ship via OTA; H8 ships via `supabase functions deploy`. Out of scope / future: migrating estimate revisions to the dedicated `estimate_versions` table (H7 Option B); exhaustive JSON.parse audit; offline-queue concurrency if per-record-ordering grouping proves unsafe (documented serial-skip fallback).
