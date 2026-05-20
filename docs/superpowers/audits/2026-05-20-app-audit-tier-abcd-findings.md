# 2026-05-20 — App-Side Audit (Tier A/B/C/D Spot Findings)

**Context:** Inline audit of the four tiers from the "engineering audit queue" surfaced after the marketing-website audit. Originally intended for parallel agent dispatch — the agents rejected every prompt-too-long variant, so the controller did this inline at compressed depth.

**Scope:** Focused on finding SHIPPABLE BUGS (things that could be patched in this batch). Not an exhaustive enumeration of every code path. Anything not called out here was either spot-checked-clean or out-of-budget for this pass.

**Branch:** `claude/p0-launch-on-main` (== `main` @ `bb9e8fa` pre-audit). Worktree: `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`.

**Methodology:** read-only inspection of high-stakes paths, comparing against `_shared/auth.ts` server-side perimeter + `useTierAccess.ts` client-side gate + `paywall.tsx` user-facing claims.

---

## Headline finding

**Tier A.AI1 (MEDIUM, FIXED in 8993431):** `supabase/functions/ai/index.ts` (text AI relay) had no upper bound on `prompt.length` or `body.maxTokens`. Every other AI relay had `MAX_PAGE_BYTES = 8MB` caps; only the text relay was unbounded. A power user (or leaked credential) could send 1MB prompts that each still count as 1 unit on `ai_text` MONTHLY_CAPS, burning 6-100x more Gemini cost than the margin model assumes. Fixed: `MAX_PROMPT_CHARS=50000`, `MAX_SCHEMA_HINT_CHARS=20000`, `MAX_OUTPUT_TOKENS_CAP=24000`, three-layer clamp on `maxTokens`. Deploys with `supabase functions deploy ai`.

That is the ONLY shippable bug found this pass. The other tiers checked clean.

---

## Tier A — Security-critical paths

### A1. Token-bearer perimeter (SECURITY DEFINER + grants)

Audited all 8 migration files with SECURITY DEFINER. Verified the canonical pattern:

```sql
revoke all on function public.<name>(...) from public;
grant execute on function public.<name>(...) to anon, authenticated;
```

✓ `portal_sign_contract` (20260518120100) — token check + ownership + revoke/grant
✓ `portal_choose_selection` (20260518120100) — same pattern
✓ `lookup_prequal_packet_by_token` (20260520180000) — `expires_at is null or expires_at > now()`
✓ `submit_prequal_packet` (20260520180000) — same TTL check
✓ `fetch_shared_schedule` (20260520180100) — `expires_at > now()` + `limit 1`
✓ `fire_notify` (grant_fire_notify_to_anon) — anon-callable BY DESIGN (triggers fire it for both anon-portal and authenticated paths). Comment correctly notes "does not expose any data the caller couldn't already write." See OBSERVATION below for the spam-amplification consideration.
✓ `award_rfp` (atomic award PG function called by award-rfp edge fn) — ownership-checked, idempotent (already-awarded throws)

**No bugs found.**

### A2. Stripe webhook + payment paths

`supabase/functions/stripe-webhook/index.ts` (498 lines):

✓ HMAC-SHA256 signature verification with constructEvent equivalent
✓ 5-minute replay protection (rejects events with `t=` older than 300s)
✓ Constant-time signature comparison (XOR-OR loop)
✓ Idempotency: `existingPayments.some((p) => p.id === paymentRecord.id)` where `paymentRecord.id = stripe-${session.id}` — handles Stripe re-deliveries
✓ Returns 200 for processed/duplicate/unknown event types so Stripe stops retrying
✓ Returns 401 on signature mismatch, 400 on invalid JSON, 500 on missing secret
✓ Uses service-role key correctly (server-side only)
✓ account.updated handler is replay-safe (same flags applied twice = same outcome)
✓ payment_intent.payment_failed is log-only (no DB write, replay-safe)

**No bugs found.** This is genuinely well-implemented.

### A3. Financing callback / redirect

`supabase/functions/financing-callback/index.ts` + `.../financing-redirect/index.ts`:

✓ HMAC-SHA256 signature validation against `FINANCING_CALLBACK_SECRET`
✓ Fail-closed semantics: secret unset or sig invalid → DB write skipped, redirect still happens
✓ Constant-time comparison (`timingSafeEqual`)
✓ Forward-only state progression (created < clicked < prequalified < funded)
✓ Unknown tokens → safe redirect to marketing site, never error page
✓ Two distinct callers handled: `?ref=<token>` (signed) and `?project=&src=portal` (anon, length-check on headers)

**No bugs found.**

### A4. AI relay tier checks + caps

✓ `analyze-drawings`: `requireTier(['pro','business'])` + `aiUsageIncrement('analyze_drawings')` + cap check returns 429 → MAX_PAGE_BYTES 8MB per page
✓ `analyze-photos`: `requireTier(['pro','business'])` + MAX_INLINE_BYTES_PER_PHOTO=6MB + MAX_INLINE_BYTES_TOTAL=8MB
✓ `analyze-spec-book`: `requireTier(['pro','business'])` + MAX_PAGE_BYTES + max 24 pages
✓ `compare-drawings`: same pattern + MAX_PAGE_BYTES
✓ `analyze-takeoff`: shares `analyze_drawings` cap (same upstream API spend)
✓ `ai` (text relay): `requireTier(['free','pro','business','enterprise'])` + `aiUsageIncrement('ai_text')` + cap returns 429 — **WAS missing prompt-length/maxTokens cap → FIXED in 8993431**

### A5. Auth + portal-passcode endpoints

✓ `auth-magic-link`: uses `supabase.auth.admin.generateLink` — inherits Supabase's built-in security primitive; we only swap the email envelope. Email regex validation. 60-min TTL is Supabase's default.
✓ `validate-portal-passcode`: constant-time comparison (`constantTimeEqual` with explicit length-mismatch decoy iteration), server-side check (passcode never echoed in response), service-role lookup since anon visitors can't read `projects` directly via RLS.

**No bugs found.**

---

## Tier B — Subsystem audits

### B1. Paywall consistency (server vs client)

Cross-referenced 3 cap tables:

| Tier | aiRateLimiter.ts (daily) | _shared/auth.ts (monthly) | paywall.tsx (display) |
|---|---|---|---|
| free | 5 / 0 smart | 150 ai_text | 5 / — |
| pro | 30 / 6 smart | 900 ai_text | 30 / 6 |
| business | 80 / 18 smart | 2400 ai_text | 80 / 18 |
| enterprise | 150 / 40 smart | 4500 ai_text | 150 / 40 |

✓ daily × 30 = monthly for all 4 tiers exactly
✓ Paywall display row matches both sources
✓ analyze_drawings / analyze_photos / takeoff_pages all match the paywall display

✓ `useTierAccess.ts` rank `{free:0, pro:1, business:2, enterprise:3}` exactly matches `_shared/auth.ts` RANK
✓ `OWNER_EMAILS` (utils/owner.ts) = `MASTER_EMAILS` (_shared/auth.ts) = `['omirmajeed2000@gmail.com', 'support@mageid.app']`

**No drift found.**

### B2. PDF generators (sealing, tampering)

Spot-checked: `seal-document` edge fn was the S1.2 ship target — generates immutable signed PDFs from contract/CO data, stores in `contract_documents` Storage bucket, writes `storage_path` + `document_hash` SHA-256 back to the source row. Audited end-to-end in the morning's session-end audit (commit `1d8453b`). No new findings this pass.

Money-doc state machines (estimate / invoice / AIA pay-app / contract / CO):
- Estimate: editable until "sent" or "approved"
- Invoice: editable until "sent", paid status from Stripe webhook (Tier A.A2 — clean)
- AIA pay-app: per-line `linkedTaskId` binding for sync-from-schedule (v2.3 Task 2 + Item 4), no tamper vector found
- Contract / CO: seal-document fn produces immutable PDF; subsequent edits would generate a new sealed PDF with a new hash

**Deferred deeper audit:** A behavioral test pass on the edit-after-send / edit-after-pay paths — out of scope this batch.

### B3. Offline queue replay

`utils/offlineQueue.ts`:

✓ MAX_QUEUE=1000 — bounded with FIFO eviction
✓ MAX_RETRIES=5 — bounded retry
✓ Terminal-error detection (`isTerminalError` matches jwt/unauthorized/permission denied/row-level security/violates/not authenticated) → discard, don't infinite-loop
✓ Per-record serial ordering via `${table}:${id}` grouping
✓ Bounded concurrency (5 groups in flight)
✓ Network-error vs other-error distinction (network → queue, other → toast + Sentry)
✓ User-bleed prevention: `wipeLocalUserCache()` in `contexts/AuthContext.tsx` clears the queue + all 30+ `tertiary_*` + `buildwise_*` keys on signout
✓ O1 fix from earlier session (insert vs upsert) preserves conflict semantics

**No new bugs found.**

---

## Tier C — Cross-cutting concerns (lightly spot-checked)

### C1. AsyncStorage migration safety
Not deeply audited this pass. Naive `JSON.parse(stored) as T` casts exist (offlineQueue, aiRateLimiter, project context). Schema drift between v2.1 / v2.2 / v2.3 has not produced field bugs because v2.1+ changes were additive (new optional fields, never type-incompatible changes). DEFER: a structured zod-validated parser layer is worth considering for future migrations but is not addressing a current bug.

### C2. Route auth gating
Not deeply audited this pass. AuthProvider wraps the entire app via `app/_layout.tsx` (verified in provider stack section of CLAUDE.md). Tab navigator gates auth. Individual screens (paywall, invoice, schedule-pro, etc.) all read `useAuth()` and redirect on null. Sub-portal flows are intentionally unauth (token-bearer). No issues spotted.

### C3. Tier coverage map (useTierAccess ↔ requireTier)
The `useTierAccess` REQUIRED_TIER table has 25 client keys. Server-side `requireTier` is called in every AI edge fn (analyze-*, ai, compare-drawings, analyze-takeoff, analyze-spec-book), seal-document, and the paid endpoints. CSV-export (S1.3) and other paid features go through `requireTier` server-side. Cross-reference is consistent — no UI-claims-pro/server-allows-free or vice versa found this pass.

### C4. Provider stack safety
Verified order in `app/_layout.tsx`: QueryClient → GestureHandler → ThemeLoader → Auth → Subscription → Project → Bids → Companies → Hire → Notification → OfflineSyncManager → RootLayoutNav. SubscriptionProvider correctly handles null user (free tier default). NotificationProvider's push-token registration is gated on auth-resolved user. No issues spotted.

---

## Tier D — Edge fn sweep (33 functions)

Spot-checked the highest-stakes 8 (stripe-webhook, _shared/auth.ts, award-rfp, financing-callback/redirect, validate-portal-passcode, auth-magic-link, ai, seal-document). All clean except the ai cap gap (fixed).

**Not audited this pass** (defer-deeper-later): notify, notify-nearby-contractors, daily-digest, morning-digest, homeowner-weekly-digest, invoice-dunning, coi-expiry-watch, schedule-ical, schedule-ical-url, geocode-bids, fetch-external-data, send-email, unsubscribe, usage-status, delete-account, connect-onboarding, connect-status, create-payment-link, convert-pdf-to-images. These are either lower-stakes (read-only digest jobs, geocode), already vetted in prior sessions, or out-of-budget for this batch.

---

## OBSERVATIONS (not fix-required)

1. **fire_notify is anon-callable by design.** A determined attacker could call it directly with arbitrary JSONB to spam the notify-fanout endpoint. The notify-fanout receiver should validate payloads, and Supabase per-IP throttling is the first defense. No clean fix without breaking legitimate trigger callers. Accept-with-context.

2. **No event.id dedup table on stripe-webhook.** Idempotency works per-invoice via paymentRecord.id, which handles the only Stripe-replay event we care about (checkout.session.completed). For account.updated, double-application is naturally idempotent (same flags). If we ever subscribe to events that AREN'T naturally idempotent, we'll need an `idempotency_keys` table.

3. **AsyncStorage type-drift is structural risk, not current bug.** All current code paths handle missing/extra fields gracefully via optional chaining + defaults. Worth a zod-validated parser layer if/when we add a major schema change that isn't strictly additive.

---

## What this audit did NOT cover

- Behavioral test pass on edit-after-send / edit-after-pay state machines
- Stripe Connect onboarding deep audit (covered briefly via webhook account.updated path)
- PDF generators beyond seal-document (other PDF paths via expo-print + Share)
- Async-storage versioning / migration strategy
- Route-level deep-link safety on web vs native
- Edge fns outside the top-8 (19 not audited)
- Performance / cost telemetry (would need PostHog query access)
- Real-time / WebSocket Supabase channel auth (separate audit surface)

---

## Verdict

**1 medium-severity bug found, 1 fixed.** All other spot-checks clean.

The codebase is in much better shape than a typical post-launch sweep would suggest — the security perimeter has clean grant patterns, the Stripe webhook is properly implemented, the cap math is mathematically consistent across all 3 sources, the offline queue handles the hard edge cases, and the master-account list is in sync between client and server.

**Recommended next deeper audits** (when bandwidth allows):
1. AsyncStorage migration strategy formalization (zod-validated parsers)
2. Stripe Connect onboarding end-to-end
3. The 19 unaudited edge fns (notification + digest + geocode + ical + dunning + cron jobs)
4. Money-doc state machines behavioral test pass
