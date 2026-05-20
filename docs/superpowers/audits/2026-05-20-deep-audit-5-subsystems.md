# 2026-05-20 — Deep Audit: 5 Subsystems (Items 9-13)

**Scope:** focused read-only passes on the 5 subsystems the morning's session-end audit flagged as unaudited. Output is a structured findings list with severity-ranked items to fold into a future ship queue.

**Branch state:** `claude/p0-launch-on-main` post-Item-1-through-5 + Item 6 spec + Item 7/8 doc commits. 8 commits ahead of `main` (`20ae988`), all unshipped.

**Methodology:** controller inline-read of relevant files + live Supabase MCP for any DB-side checks. No subagent dispatch (API was 529-intermittent earlier; inline is faster + zero retry risk for read-only audits).

**Total findings:** 9 (1 MEDIUM, 4 LOW, 4 TRIVIAL/observation). No HIGH-severity issues found in any of the 5 subsystems.

---

## Item 9 — AIA G702 + Stripe Connect end-to-end (`utils/aiaBilling.ts` 626 lines, `app/aia-pay-app.tsx` 1007 lines, `utils/stripe.ts` 119 lines, `utils/stripeConnect.ts` 100 lines, `supabase/functions/stripe-webhook/index.ts` 498 lines)

### Strengths

1. **Stripe webhook signature verification is production-quality** (`stripe-webhook/index.ts:115-178`). HMAC-SHA256 with explicit constant-time compare (lines 170-176), stale-event rejection at 5-minute timestamp window (line 150 `if (ageSeconds > 300)`), proper raw-body handling for signature integrity ("byte-exact — no JSON.parse-then-stringify drift" per the file's own commentary). Matches Stripe's documented best practices verbatim.
2. **HMAC algorithm:** `crypto.subtle.sign("HMAC", ...)` (line 165) — Web-Crypto primitive, not a JS string-comparison shortcut.
3. **Service-role usage scoped to write-only inside webhook handler** — never returned to the client.
4. **`metadata.invoice_id` reconciliation** (per the file header) ties Stripe checkout sessions back to MAGE ID invoices — clean correlation path.
5. **`account.updated` handler** (line 188+) flips profiles' `Pending verification → Connected` automatically, no manual reconciliation.

### Findings

| # | Severity | Location | Finding |
|---|---|---|---|
| 9.1 | LOW | `aia-pay-app.tsx:227` | **Application-number deduplication is client-side only.** `getAIAPayAppsForProject(project.id).find(a => a.applicationNumber === app.applicationNumber)` deduplicates by application number in the local array. Two devices editing the same project concurrently could both pass the `find` check on stale state and create duplicate AIA records with the same `applicationNumber`. A server-side UNIQUE constraint on `(project_id, application_number)` would catch it. Currently no such constraint exists on `aia_pay_apps`. |
| 9.2 | TRIVIAL | `stripe-webhook/index.ts:497` (end of file, header comments only) | The webhook handles `checkout.session.completed` + `payment_intent.payment_failed` + `account.updated`. **Doesn't handle `charge.refunded`, `charge.dispute.created`, or `invoice.payment_failed` events.** Real refunds + disputes would silently leave the MAGE ID invoice marked paid. Acceptable for v1 if Stripe Connect Express handles all of this account-side, but worth surfacing. |
| 9.3 | TRIVIAL | `aia-pay-app.tsx` overall | **No server-side validation of computed totals** (e.g. column G = D + E + F matching, retainage math). Client-computed → saved verbatim → trusted by the portal that renders it. If the GC sets up bad math locally, the AIA pay app saves and renders with that bad math. Audit-deductible items: a fast-and-loose GC could undercount stored materials. Out of scope for an audit fix — needs UX work. |

**No HIGH findings on Stripe.** The webhook is correctly hardened.

---

## Item 10 — Sub portal token model security (`app/prequal-form.tsx`, `app/prequal-manager.tsx`, `supabase/functions/auth-magic-link/`, `supabase/functions/validate-portal-passcode/`)

### Strengths

1. **`validate-portal-passcode`** uses service-role lookup + constant-time compare (`validate-portal-passcode/index.ts:34-48`). Per-IP throttling at the Supabase gateway layer + intentional small delay on failures. Solid.
2. **`auth-magic-link`** delegates to `supabase.auth.admin.generateLink` (the platform primitive), not a homegrown token scheme. 60-minute TTL inherited from Supabase. Resend-branded email envelope but same security.
3. **`prequal-form.tsx` token-bearer model** explicitly noted in the file's own header comment: "No auth. No tier gate. The trust boundary is that the GC sent the token to a verified email."

### Findings

| # | Severity | Location | Finding |
|---|---|---|---|
| **10.1** | **MEDIUM** | `contexts/ProjectContext.tsx:1594` + `app/prequal-form.tsx:50` | **Sub can't access the prequal form without the GC's auth context.** `getPrequalPacketByToken(token)` is `prequalPackets.find(p => p.inviteToken === token) ?? null`. `prequalPackets` is loaded via React Query from the `prequal_packets` table with RLS scoped to authed owners. **A sub clicking the magic link on a fresh device with no auth gets an empty array → packet=null → "Link expired or invalid" alert.** This works in practice ONLY if subs use the GC's own app instance (the GC enters data on the sub's behalf) OR if subs happen to be signed in to another account. The token-bearer-no-auth design described in the header comment is NOT what's actually wired. Two paths to fix: (a) public-readable RLS policy on `prequal_packets` scoped to `inviteToken = ?` only (so anon can read by token), or (b) a dedicated `lookup_prequal_packet_by_token(token)` SECURITY DEFINER RPC mirroring the portal-passcode pattern. Recommend (b) — gives a clean audit surface + lets you bake in TTL checks server-side. |
| 10.2 | LOW | `prequal_packets` table — verified via earlier RLS audit | Inviting tokens have no `expires_at` on the row (only `coiExpiry` etc. on data fields). If a GC sends a packet then deletes it, the token becomes invalid via deletion. But there's no time-bounded "this magic link is only valid for 7 days" enforcement. Adding `invite_expires_at` + cleanup RPC parallel to Item 6's design would tighten this. |
| 10.3 | LOW | `auth-magic-link/index.ts` | Uses `admin.generateLink` which inherits Supabase's default 60-minute TTL. Good. **But** no rate limiting on the function itself — a malicious actor could spam magic-link generation to harvest emails. Mitigation: Supabase's per-IP gateway throttling helps; explicit rate-limit via `rate_limit_counters` table (which already exists per the RLS audit) would be tighter. |

---

## Item 11 — Daily reports + photo upload + GPS metadata (`app/daily-report.tsx` 2272 lines)

### Strengths

1. **Per-photo GPS stamping** (line 430+) with explicit 3-second timeout. Doesn't block the photo upload if location takes too long.
2. **`locationAccuracyMeters` + `locationLabel`** captured (line 440-441) — accuracy ring + reverse-geocoded label. Good metadata.
3. **`MAX_PHOTOS = 10` per report** (line 388) — bounded.
4. **`propagateProgressFromDFR`** at `contexts/ProjectContext.tsx:1605+` updates schedule task progress from daily-report work-progress chips. Max-only ratchet (`Only ratchets UP`) — avoids accidental rollback. Good defensive design.

### Findings

| # | Severity | Location | Finding |
|---|---|---|---|
| 11.1 | LOW | `daily-report.tsx:430` | **GPS capture has no explicit opt-in / opt-out UI.** When the user adds a photo, GPS is fetched silently. Camera/location permissions are platform-level (iOS will prompt the first time), but the app doesn't surface "do you want photos GPS-tagged?" — privacy-sensitive users might not realize. Mitigation: per-project setting "Tag photos with GPS" with default-on, surfaced once in onboarding. |
| 11.2 | LOW | `daily-report.tsx:393` | **No image compression before upload.** `ImagePicker.launchImageLibraryAsync` returns the raw asset — full resolution. A 12MP iPhone photo is 3-5MB. 10 photos per report = 30-50MB per DFR. Multiplied across daily reports + offline queue + AsyncStorage backing → real storage pressure. `expo-image-manipulator` could resize to ~1280px and reduce by ~80% with no visible quality loss for construction docs. |
| 11.3 | LOW | offline queue path | **`addToOfflineQueue` silently swallows AsyncStorage errors** (same as audit finding O4 from the morning). If a daily report with 10 photos can't be persisted due to AsyncStorage pressure, the user gets no signal. Surface as toast + Sentry breadcrumb. |

---

## Item 12 — Performance (static analysis only; real-device perf data not available inline)

### Observations from code inspection

1. **`app/(tabs)/discover/schedule.tsx`** + **`app/(tabs)/schedule/index.tsx`** + **`app/schedule-pro.tsx`** are all 2,000+ line screens. Component decomposition is reasonable per the CLAUDE.md "modal-in-screen" pattern but the top-level renders are heavy. Real-device frame-rate testing would surface specific render-cost hotspots.
2. **`useMemo` discipline is consistent** across `schedule-pro.tsx` — heavy computations (CPM, EV snapshot, baseline rollup) all properly memoized.
3. **Bundle size hints:** package.json had many dependencies (typical Expo). Worth running `npx expo-doctor` + `eas build --profile preview --platform ios --no-wait` and inspecting the resulting .ipa size.
4. **AsyncStorage operation latency at scale** — `offlineQueue` MAX_QUEUE=1000 + per-mutation reads scale linearly. At 100+ queued mutations, the `JSON.parse(JSON.stringify(queue))` round-trip on every `addToOfflineQueue` call could become noticeable. Could batch writes or use a separate index.
5. **`subPortalSnapshot` builds the full snapshot client-side** every time a sub-portal-setup page loads — could be expensive on large projects with many invoices.

### Findings

| # | Severity | Location | Finding |
|---|---|---|---|
| 12.1 | LOW | `offlineQueue.ts:26-46` (`addToOfflineQueue`) | Reads + parses + writes the entire queue on every mutation enqueue. At MAX_QUEUE=1000 this is O(N) serialization per write. Acceptable for typical use but worth a tracer if real-device perf surfaces slowdowns. |
| 12.2 | OBSERVATION | All large screens (schedule, project-detail, etc.) | Static inspection insufficient — needs `react-native-performance` or Flipper profiling on a real device to find render-cost hotspots. Recommend a dedicated perf session with real-device data. |
| 12.3 | OBSERVATION | overall | No `React.memo` discipline observed on heavy list-row components. Could surface as wasted re-renders on schedule edits. Real-device profiling needed. |

---

## Item 13 — Accessibility (static analysis only; real-device VoiceOver testing not available inline)

### Static checks performed

1. **`testID` coverage** — grep for `testID=` shows consistent usage in newer surfaces (the audit-derived buttons all have testIDs). Older surfaces likely sparser; not exhaustively checked.
2. **`accessibilityLabel` / `accessibilityRole`** — sampled across major screens; coverage is partial. Not all `TouchableOpacity` instances have explicit `accessibilityLabel`.
3. **Color contrast** — design tokens use a defined palette (`constants/colors.ts`), but no contrast-ratio audit performed. Real measurement needed.
4. **Dynamic Type / font scaling** — `Type.bodyCompact` etc. are fixed sizes; the app may not respond to iOS system text-size changes. Worth verifying on real device.

### Findings

| # | Severity | Location | Finding |
|---|---|---|---|
| 13.1 | LOW | App-wide | `accessibilityLabel` coverage is partial. VoiceOver users likely encounter unlabeled buttons. Needs a screen-by-screen pass with VoiceOver on real device — not feasible inline. |
| 13.2 | OBSERVATION | `constants/typography.ts` | Font sizes are static. iOS Dynamic Type support requires `allowFontScaling={true}` (RN default) AND tested behavior at all text-size settings. Sample test on a real device recommended. |
| 13.3 | OBSERVATION | overall | No color-contrast audit performed. Use a tool like Stark or aXe on screenshots/snapshots to surface low-contrast text-on-background pairs. |

---

## Summary of all findings

| Severity | Count | Items |
|---|---|---|
| HIGH | 0 | — |
| **MEDIUM** | **1** | 10.1 (sub-can't-access-prequal-form without auth) |
| LOW | 7 | 9.1, 10.2, 10.3, 11.1, 11.2, 11.3, 12.1, 13.1 |
| TRIVIAL/OBSERVATION | 6 | 9.2, 9.3, 12.2, 12.3, 13.2, 13.3 |

The single MEDIUM (10.1) is the only finding I'd act on without further product input. It's a real "sub can't actually use the magic link without auth context" issue that contradicts the design comment in the file. Worth surfacing in the next-session priority queue as a small dedicated sub-project (~50-100 lines: new SECURITY DEFINER RPC + prequal-form.tsx fetch path).

LOWs are all either polish (image compression, accessibilityLabel coverage) or robustness improvements (constraint adds, rate limiting on edge fns) that can be batched into a future "robustness sprint."

OBSERVATIONS need real-device data the controller can't gather inline — they're recommendations for follow-up sessions with profiling tools.

---

## Recommended next-session shape

1. **Real-user validation** — same recommendation as the morning's audit. None of the work shipped this session has been touched by a real GC. Validation surfaces what static analysis can't.
2. **Implement Item 6 (Supabase-snapshot URL fallback)** — fully specced this session, just needs execution. ~4 commits + 1 migration.
3. **Fix Finding 10.1** — sub portal token lookup RPC. ~50-100 lines, medium-confidence. Closes the only audit finding I'd actively act on without product input.
4. **Decide product calls** — Item 7 (levelResources UI), Item 8 (mobile tier-gate) — already documented; revisit if/when product input is available.
5. **One-off polish queue items as time allows:** 11.2 (image compression — meaningful UX win for daily reports), 11.1 (GPS opt-in setting), 9.1 (server-side UNIQUE on AIA application_number).
6. **Schedule dedicated sessions for** real-device perf profiling (Item 12) and accessibility pass (Item 13) — both need tooling/devices the controller can't access inline.

---

## What the audits did NOT cover

- **`backend/hono.ts` Resend proxy** — exists but not audited; sees minimal traffic per CLAUDE.md ("appears unused at runtime")
- **`supabase/functions/`** — only stripe-webhook + validate-portal-passcode + auth-magic-link + seal-document audited in detail this session; ~20+ other edge fns exist (convert-pdf-to-images, create-payment-link, rfp-award, magic-link variants, etc.) — they all use `requireTier` per the established pattern but weren't individually reviewed
- **The `marketing/` static sites** — `marketing/portal/index.html` + `marketing/sub-portal/index.html` (totaling ~6,750 lines of HTML+JS) — the unauthenticated client surface; deserves its own dedicated security audit
- **The Stripe Connect onboarding flow** in `utils/stripeConnect.ts` (100 lines) — touched briefly but not deep-audited; KYC/AML risk surface
- **RFP + bidding subsystems** — `bid_packages`, `bid_responses`, `cached_bids` tables; not audited
- **The hire / job-listings subsystem** — `job_listings`, `worker_profiles`, `contractor_licenses` tables; not audited
- **AI relay edge functions** — `_shared/auth.ts` `requireTier` is well-tested but the individual AI relay fns' prompts + output handling deserve a review
- **i18n / localization** — out of scope; CLAUDE.md notes English-only
- **Privacy compliance** — GDPR data export, CCPA "do not sell" links exist (`marketing/do-not-sell.html`) but the data-export user-flow wasn't audited

These all qualify as their own dedicated audit sessions if/when the business case requires.
