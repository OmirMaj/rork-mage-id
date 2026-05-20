# 2026-05-20 — Session-End Focused Audit

**Scope:** post-v2.2b ship session-end audit of the four subsystems the original 2026-05-19 CPM-focused audit didn't cover: `utils/offlineQueue.ts`, `supabase/functions/seal-document/index.ts`, the AIA pay-app persistence path, and the RLS perimeter on the live Supabase project `nteoqhcswappxxjlpvap`. Read-only — no code changes in this audit pass. Output is the next-session priority queue.

**Methodology:** controller inline-read of the files + live `pg_policies` / `pg_class` queries via Supabase MCP. No subagent dispatch (API was 529-intermittent earlier in this session; inline avoids retry overhead for a read-only deliverable).

**Branch state at audit time:** `main` at `20ae988` after the v2.2b OTA published (group `22224da9-3f57-4dc4-9006-b978dedcbebe`). Original CPM audit ledger now 13-of-14 closed (Gap E remains).

---

## A. `utils/offlineQueue.ts` (228 lines)

### Strengths

1. **Bounded retries** (`MAX_RETRIES = 5`, `cpm.ts:5`) + discard after max — no infinite retry loops.
2. **Terminal-error detection** (`isTerminalError`, lines 50-60) — auth/RLS/permission errors discarded immediately instead of looped. Prevents "stale JWT → infinite retry" scenarios.
3. **Bounded memory** (`MAX_QUEUE = 1000`, FIFO drop oldest at line 36-40). Prevents AsyncStorage from growing unbounded.
4. **Causal ordering preserved within record** (group-by-record-key at lines 76-85; serial-within-group at lines 87-135). Insert-before-update on the same row can't race.
5. **Bounded concurrency across groups** (`MAX_CONCURRENCY = 5`, line 138). Doesn't flood the network on reconnect.
6. **`.insert()` not `.upsert()` inside the queue** (line 100, with explicit comment at :98-99): "upsert here would silently overwrite a colliding row that some other client already created, masking conflicts." Correct conflict semantics for queued retries.
7. **Sentry integration** for non-network errors (lines 217-223) — observability into prod failures.
8. **User-facing toast on non-network errors** via `nailIt`/`oops` (lines 211-215) — users get told instead of silent loss. (AUD-001 referenced in comment.)

### Findings

| # | Severity | Location | Finding |
|---|---|---|---|
| O1 | **MEDIUM** | `:173` vs `:100` | **`supabaseWrite` direct-write uses `.upsert()` (line 173); `processOfflineQueue` queued retry uses `.insert()` (line 100).** Inconsistent semantics: a save that "worked online" by upserting over a colliding row will silently FAIL when retried offline because the queued insert hits a unique violation. The fix is to align them — either both upsert (matches "save worked" optimism) or both insert (matches "explicit conflicts" pessimism). The queue's comment argues for plain insert; if that's the canonical choice, `supabaseWrite` should match. |
| O2 | LOW | `:50-60` | `isTerminalError` does substring matching on error messages (`m.includes('jwt')`, etc.). Brittle: Supabase error message wording could change; localized error strings could miss. Better: check PostgREST error codes (`PGRST116`, `23505`, etc.) returned in `error.code`. Existing pattern works for typical en-US Supabase errors today. |
| O3 | LOW | `:190-195` | `isNetworkError` uses the same brittle substring approach (`'Network request failed'`, etc.). `err instanceof TypeError` catches some fetch failures. Acceptable but worth noting. |
| O4 | LOW | `:43-45` | `addToOfflineQueue` silently swallows AsyncStorage write errors. If AsyncStorage is full or corrupt, the mutation is lost AND the user isn't notified. Could surface a toast + Sentry breadcrumb on this catch. |
| O5 | LOW | `:62-160` | `processOfflineQueue` returns `{ processed, failed }` only — no per-mutation status. Caller can't tell user "we couldn't save your invoice from last Tuesday" with specifics. Acceptable for current UX (just a count) but a richer return shape would enable better surfacing. |
| O6 | LOW | n/a | No timestamp-based stale-mutation discard. A mutation queued 30 days ago will attempt to sync. Bounded by `MAX_QUEUE = 1000` FIFO in practice, but explicit "drop mutations older than N days" would be safer. |
| O7 | TRIVIAL | `:31` | `Math.random().toString(36).slice(2, 8)` for IDs — 36⁶ = ~2B unique strings per millisecond. Collision risk is tiny but nonzero. `crypto.randomUUID()` if available would be stronger. Not a real problem. |

**O1 is the only finding I'd act on without further product input.** The others are observability/robustness improvements that can wait.

---

## B. `supabase/functions/seal-document/index.ts` (138 lines)

Already opus-reviewed during S1.2 ship. Re-confirmed post-v2.x state. **No new findings.**

### Strengths re-verified
- Three-layer authz: Storage RLS bucket-scoped + path-prefix check at `:87-89` + ownership SELECT at `:96-99`.
- Hash-mismatch path returns 400 at `:113-115`.
- DB UPDATE binds both `id` AND `user_id` at `:122-124` (defense-in-depth).
- `bytes.byteLength === 0` empty-upload check at `:108`.
- `requireTier(['free','pro','business','enterprise'])` at `:62` — legal-grade primitive ungated.

### Nits noted but not flagged for action
| # | Severity | Note |
|---|---|---|
| S1 | TRIVIAL | No rate limiting on the endpoint. A user could spam it. requireTier doesn't rate-limit. Theoretical abuse vector. |
| S2 | TRIVIAL | Error responses leak internal details: `lookup failed: <msg>`, `download failed: <msg>` — could surface Postgres error strings to the client. Low PII concern; helps debugging in prod. |
| S3 | TRIVIAL | `storage_path` accepts unbounded length. Bounded by Supabase ingress limits; not a real DoS vector. |

---

## C. AIA pay-app persistence path (`app/aia-pay-app.tsx` 984 lines + `utils/aiaBilling.ts`)

Brief surface scan — not a full audit. Recent touches in v2.3 A2 ("Sync from schedule" button at `:541-556`) already opus-reviewed during v2.3.

### Surface observations
- `buildSavedRecord` at `:225` and persistence via `addAIAPayApp` (context) — standard create-or-update pattern.
- **Race observation (LOW):** `:227` `getAIAPayAppsForProject(project.id).find(a => a.applicationNumber === app.applicationNumber)` deduplicates by application-number client-side. Two devices editing the same project's AIA pay-app concurrently could both pass the `find` check on stale state and create duplicate AIA records with the same `applicationNumber`. The offline queue's causal ordering doesn't protect against this — it's two different `id` values from two devices. Server-side unique constraint on `(projectId, applicationNumber)` would catch it.
- Beyond this brief scan, the AIA path would benefit from a dedicated audit (separate session) covering the full bill-from-estimate → invoice → AIA → seal flow + Stripe payment-link integration.

**No findings actionable from this scan alone.** AIA path: needs a dedicated audit, not just spot-checks.

---

## D. RLS perimeter (live Supabase `nteoqhcswappxxjlpvap`)

### Top-level health

**All 78 public tables have `rls_enabled = true`.** Zero open tables. Every table has at least 1 policy.

### Distribution
| Policy count | Tables |
|---|---|
| 1 policy (single ALL-ops or single SELECT) | 30 |
| 2 policies | 4 |
| 3 policies | 8 |
| 4 policies (typical owner-CRUD split) | 14 |
| 5 policies | 5 |
| 6 policies | 3 |
| 7 policies | 3 |
| 8+ policies (sharing patterns) | 11 |

### Drill on the 1-policy user-data tables

Drilled into `prequal_packets`, `cois`, `commitments`, `leads`, `aia_pay_apps`, `permits`, `oac_meetings`, `warranties`, `bid_packages`, `bid_package_bids`, `financing_referrals`, `drawing_pins`, `plan_calibrations`, `plan_markups`, `plan_sheets`, `pro_responses`, `rate_overrides`, `ai_daily_usage`, `ai_usage_counters`.

**Every single one verified owner-scoped via `auth.uid() = user_id`** (or equivalent like `gc_user_id = auth.uid()` for financing_referrals).

The "1-policy" pattern is just `FOR ALL ... USING (...) WITH CHECK (...)` instead of split SELECT/INSERT/UPDATE/DELETE policies. Functionally equivalent; tighter to write.

### Cosmetic inconsistency (LOW — not a security gap)
Some tables use `to {public}` while most use `to {authenticated}` — both with `auth.uid() = user_id` predicate inside. The `{public}` ones include `drawing_pins`, `plan_calibrations`, `plan_markups`, `plan_sheets`. The `auth.uid() = user_id` check is sufficient (anon users have `auth.uid() = null` which fails the equality), but the role grant is broader than needed. Standardizing on `{authenticated}` would be cleaner.

### No findings actionable from this scan

The RLS perimeter is genuinely tight. The original CPM audit's bug #4 "criticalPathDays sources" was a far bigger trust issue than anything in the RLS layer.

---

## E. Cross-cutting

### What this audit did NOT cover (worth its own session)
- **AIA G702 flow end-to-end** (only brief scan above)
- **Stripe Connect + Stripe webhook** (financial-handling code; high-value-target for adversarial review)
- **Daily reports + photo upload + GPS metadata** (offline queue interactions)
- **Sub portal token model** in detail (S3 audit was scope-skipped earlier this session because the surface was already shipped; security review of the token-bearer model would still be valuable)
- **Performance** — bundle size, render perf on real devices, AsyncStorage operation latency at large queue sizes
- **Accessibility** — screen reader, color contrast, font scaling
- **Offline-edge correctness** — what happens when AsyncStorage is corrupt on app boot, what happens during a long offline period with cumulative drift, etc.

### Audit ledger after this pass

| Subsystem | Status |
|---|---|
| CPM engine (original audit) | 13 of 14 items closed |
| `utils/offlineQueue.ts` | **Audited (this pass).** 1 medium finding (O1) + 6 low/trivial. |
| `seal-document` edge fn | Re-confirmed post-v2.x. No new findings. |
| AIA pay-app path | Brief scan only. Dedicated audit recommended. |
| RLS perimeter | **Audited (this pass).** Clean. No actionable findings. |
| Other subsystems (Stripe, daily reports, sub portal token model, perf, a11y) | Not audited this session. |

---

## F. Next-session priority queue

### Tier 1 — Validate before building (highest priority)

**Real-user testing of the 3 OTAs shipped this session.** None have been touched by real users yet:
- `b2151ce3-…` (v2.1 schedule engine-truth)
- `ae173955-…` (S1.2 sealed signed contracts)
- `52a9e652-…` (S1.1 CSI cost codes)
- `fcf4f8b0-…` (S1.3 QuickBooks/Xero export)
- (post-audit) `b2151ce3-…` (v2.3 + polish + v2.2a — *also* `bd30577d-…`)
- `22224da9-…` (v2.2b calendar-aware CPM — *just shipped*)

A real GC putting these through normal use will surface issues that no amount of inline review catches. Don't ship more until at least one full GC use case validates.

### Tier 2 — Open audit-derived items

- **Gap E** — `recalculateStartDays` + `runCpm` double-execution elimination. Needs persist-flow contract decision: should `task.startDay` always reflect engine ES post-edit?
- **v2.2c Layer B** — per-resource calendars via `resolveCalendarForTask`. Layer A (v2.2b) just shipped; Layer B is its natural extension.
- **Per-AIA-line `linkedTaskId`** — extends v2.3 A2; `SavedAIAPayAppLine` schema-shape change.

### Tier 3 — Active versions of telemetry-only items

- **Active estimate → schedule re-sync** — extends v2.3 C (telemetry-only). Needs "tasks impacted by this estimate change" UX.
- **Active Supabase-snapshot URL fallback** — extends v2.3 P1 (typed-error-only). New table `shared_schedule_snapshots` + token redirector mirroring `sub_portal_snapshots`.

### Tier 4 — Cleanup / robustness

- **O1: `supabaseWrite` insert/upsert inconsistency** — pick one semantic. Recommend matching the queue's plain `.insert()` so "save worked" semantics don't mask conflicts. ~5-10 line change.
- **O2/O3: error-detection refactor** — switch to PostgREST error codes instead of message substring matching. Mid-size change; touches both `isTerminalError` and `isNetworkError`.
- **O4: surface AsyncStorage write failures** — toast + Sentry breadcrumb when `addToOfflineQueue` can't persist.
- **`scripts/generate_bundles.py` audit** — the v2.1-residue cleanup (commit `32a1360`) only patched the earnedValueEngine reference; there may be other stale refs (mentioned in v2.1 opus review as non-blocking).
- **RLS role-grant standardization** — flip the 4 `{public}` tables to `{authenticated}` for consistency. Zero-risk cosmetic migration.

### Tier 5 — Product decisions needed first

- **`runCpm({ levelResources: true })`** — UI surfacing or removal. Currently wired but invisible. Product decision: do we want it surfaced as a Pro feature, or delete it?
- **Mobile classic-schedule tier-gate** — already documented as deliberate (v2.3 §7); revisit only if marketing data shows the free on-ramp isn't converting.
- **AIA-line `linkedTaskId` UX** — when a user opens AIA pay-app, do they want a picker per line or auto-mapping? Affects v2.3 A2 follow-up design.

### Tier 6 — Subsystems needing dedicated audit (lower priority unless something surfaces)

- **AIA G702 + Stripe flow end-to-end** — payment-link generation, webhook handling, retention logic, lien-waiver flow
- **Sub portal token model** — security review of the token-bearer + RLS-bypass via SECURITY DEFINER RPCs
- **Daily reports + photo upload** — offline queue interactions, GPS metadata privacy
- **Performance** — bundle size analysis, render perf on iPhone 12-class device, AsyncStorage latency at 500+ queue entries
- **Accessibility** — VoiceOver pass, color contrast, dynamic type

---

## G. Honest meta-note

The user said "do whatever is needed to make this app perfect" earlier this session. "Perfect" isn't a real target — but **13 of 14 original audit items closed, the engine is internally consistent, the cross-domain wedges are wired, and the RLS perimeter is clean** is genuinely close to "production-ready for the build-out work done this session." What's left is mostly:

1. **Validation gap** — none of this is touched by a real user yet. Tier 1 above.
2. **Product-decision gaps** — levelResources, AIA-line mapping, mobile tier-gate — engineering can't unilaterally pick these.
3. **Subsystems outside this session's scope** — Stripe, daily reports, sub portal token model, perf, a11y — each is a real audit's worth of work.

A reasonable next-session goal: validate one real GC use case end-to-end (Tier 1), then pick **O1** as a tiny standalone fix (the only audit finding actionable without further product input), then start brainstorming whichever Tier 2/3 item the validation testing surfaces as highest-pain.

That's "make this app perfect" in practice: ship, validate, fix what real use surfaces, repeat.
