# Phase 1 — Make It Launchable (Design Spec)

_Date: 2026-08-04. Derives from `docs/path-to-billion-roadmap.md` (Phase 1). Scope confirmed by code exploration + three product decisions (below). This is the code half of Phase 1; two prerequisites are owner actions, documented but out of code scope._

## Goal & exit condition

**A real first user can install, use, and pay — without hitting a fabricated number or a dead end.**

The billion-dollar roadmap's ground truth: 1 install, 0 conversions. Before spending on acquisition, the bucket must not leak. This spec closes the remaining product-integrity and funnel-handoff leaks that would burn the first cohort.

## What is ALREADY done (verified in current code — NOT in scope)

Code exploration on 2026-08-04 found much of the original 08-03 audit already remediated on main:

- **The 7 project-scoped dead-end screens are fixed.** `invoice`, `job-costing`, `daily-report`, `punch-list`, `rfi`, `client-portal-setup`, `closeout-binder` — plus `schedule-pro` — all render the shared `ToolProjectPicker` (`components/ToolScreenChrome.tsx`) when opened with no project. `featureRegistry.ts:23-37` documents the fix. ✅
- **Most invented-number defaults are null-gated.** `utils/paymentPrediction.ts` no longer has `.default(50/21)` on numeric fields (comment at :50-51 explains why); `estimate-wizard.tsx` dropped the `?? 70` confidence fallback (:681-691) and the misleading `Contingency (~10%)` label (:119-127). ✅
- **The client PDF already guards `bulkSavings`.** `utils/pdfGenerator.ts:521` and `:1538` render the Bulk Savings line only when `(bulkSavingsTotal ?? 0) > 0`, so no `-$0.00` prints. ✅

The remaining leak is that **nothing computes `bulkSavings`** (so the guard means it never shows for a real user, and the demo shows a fabricated figure), and the **deep-link resolver + marketing handoff are still broken**.

## Product decisions (locked)

1. **`bulkSavings` → compute it for real** (not delete). Derive from buyout awards; show only when `> 0` and sourced.
2. **Invented-number cleanup → client-facing + high-harm only.** Most already done; only `plan-intelligence` cold-start rates remain. Defer the comprehensive copy sweep (upsell deltas, cost-xray likelihood, BidHitScoreboard benchmark, uncited "industry" stats) to a later pass.
3. **Plan/trial handoff → capture + pre-select tier.** Persist the intent and pre-select the tier on the paywall; actual trial activation rides on RevenueCat (owner task).

---

## Piece 1 — Real Bulk Savings (compute for real)

### Problem
`Estimate.bulkSavingsTotal` is declared **required** (`types/index.ts:74`) but is written **only by seed/demo files** (`demoSeed.ts`, `dev-seeder.tsx`, `dev-flagship-seeder.tsx`) — zero computation paths. It is read/rendered at 6 sites in `app/project-detail.tsx` (`:1109, :1162, :1198, :1451, :2409`, plus the `:1073` assignment) and flows into the client PDF. It is the last surviving fabricated headline dollar figure.

### The data already exists
The app computes per-package buyout savings today:
- `BidPackage` (`types/index.ts:2034-2071`) has `linkedEstimateItemIds`, `estimateBudget`, `awardedBidId`, `awardedCommitmentId`, and a stored `buyoutSavings?: number`.
- `ProjectContext.tsx:2845` computes `savings = pkg.estimateBudget - committedAmount` at award time, where `committedAmount = awardedBid.amount`.
- `Commitment` (`types/index.ts:2138-2167`) holds the signed `amount` and links back via `linkedEstimateItems`.

So **project-level real bulk savings = Σ `buyoutSavings` over awarded packages** — no new source data needed.

### Design: a pure engine util
Following the repo engine convention (`utils/jobCostEngine.ts` is the model — pure function, no storage side effects, re-derived on render):

Create `utils/bulkSavings.ts`:

```ts
export interface BulkSavingsLine {
  packageId: string;
  packageName: string;
  estimateBudget: number;   // Σ linked estimate lineTotals
  awardedAmount: number;    // signed commitment.amount (+ changeAmount)
  savings: number;          // estimateBudget - awardedAmount (may be negative = overrun)
}

export interface BulkSavingsSummary {
  bulkSavings: number;          // Σ of positive-and-negative line savings across AWARDED packages
  awardedPackageCount: number;  // packages actually awarded with a signed commitment
  totalBudgeted: number;
  totalAwarded: number;
  byPackage: BulkSavingsLine[];
  hasRealData: boolean;         // awardedPackageCount > 0
  source: 'measured_from_buyout';
  asOf: string;
}

export function computeBulkSavings(
  projectId: string,
  bidPackages: BidPackage[],
  commitments: Commitment[],
): BulkSavingsSummary
```

Rules that keep it honest (mirroring `costSeedCore.ts`'s provenance discipline):
- **Only `status: 'awarded'` packages with a resolvable signed `Commitment` count.** Forward estimates and open/leveling packages never contribute. A package awarded but with no signed commitment yet is excluded (not counted as savings).
- `awardedAmount` uses the actual `Commitment.amount + (changeAmount ?? 0)` — so an awarded sub that later grows via a CO correctly erodes the reported saving.
- `bulkSavings` includes negative package lines (an overrun) in the sum, so the number is the true net — never cherry-picked to look good.
- `hasRealData = awardedPackageCount > 0`. **The UI shows the figure only when `hasRealData && bulkSavings > 0`.**
- `source: 'measured_from_buyout'` — a distinct provenance from `'seed'` and `'closed_job'`, so it is never conflated with a seeded claim or a closed-job actual.

### Render integration (`app/project-detail.tsx`)
- Compute once via `useMemo(() => computeBulkSavings(project.id, bidPackages, commitments), [...])`, sourcing `bidPackages` and `commitments` from `ProjectContext`.
- Replace all 6 seed-reads with the computed `summary`.
- Gate every render site on `summary.hasRealData && summary.bulkSavings > 0`. When absent, render **nothing** (not `$0`) — same discipline as `RecoveredCard` (`components/home/RecoveredCard.tsx:72-76`, which renders null at $0).
- Add a **grounding chip** on the hero savings figure per the standing brain-center directive (grounded + honest): e.g. `Measured from your buyout · {awardedPackageCount} package{n>1?'s':''}`, tappable to the per-package breakdown (`byPackage`). This replaces the current "How Bulk Savings Work" explainer with a real, sourced one.

### Client PDF (`utils/pdfGenerator.ts`)
- The generator reads `legacyEst.bulkSavingsTotal` and already guards `> 0`. Compute the summary before generating and pass the real number in (set `bulkSavingsTotal` on the object handed to the generator, or thread a `bulkSavings` field). Because the guard already exists, a real `> 0` value simply flows; a project with no awarded packages prints no Bulk Savings line. `PDFPreSendSheet.tsx`'s "Bulk Savings Breakdown" section should likewise be enabled only when `hasRealData && > 0`.

### Type honesty & seeds
- `bulkSavingsTotal` is a **derived** value; stop treating it as authored state. Make it `bulkSavingsTotal?: number` (optional) on the type, OR remove it from the type and render purely from `computeBulkSavings`. Preferred: **remove the stored field** and compute live everywhere it was read (matches `computeJobCost`'s "never store, always derive" pattern). Keep the field only if the PDF path is cleaner passing a number.
- Update seed files: **stop setting `bulkSavingsTotal`.** For the flagship demo to still showcase savings, the seed should instead create a couple of **awarded `BidPackage`s with signed `Commitment`s** whose `estimateBudget − amount > 0`, so the demo shows a *real, sourced* saving. (Demo-data task, tracked in the plan.)

### Edge cases
- Awarded package, no signed commitment → excluded (0 contribution), not an error.
- Awarded amount > estimate (overrun) → negative line, lowers the net; never hidden.
- No bid packages at all (most new projects) → `hasRealData = false` → UI shows nothing. This is the common cold-start path and must be silent, not `$0`.

### Tests (engine convention — no jest in repo)
`scripts/verify-bulkSavings.ts` (throwaway, deleted before commit per CLAUDE.md): assert (a) empty input → `hasRealData:false, bulkSavings:0`; (b) one awarded package $10k budget / $8.5k commitment → $1,500, count 1; (c) an overrun package nets against a saving; (d) awarded-but-uncommitted package contributes 0; (e) a `changeAmount` on the commitment erodes the saving.

---

## Piece 2 — Deep-link resolver rebuild + post-login replay

### Problem
`utils/deepLinkScheme.ts:51-63` `resolveDeepLinkPath` returns `/` for every path not in `PUBLIC_PATHS` (currently just `prequal-form`, `reset-password`). `app/+native-intent.tsx` routes all inbound system paths through it. Result: **~99 in-app routes silently resolve to Home** — breaking `qbo-setup` (OAuth callback, `integrations/qbo/callback.tsx:84,98`), `claim-crew?token=` (`utils/crewScan.ts:43`), `client-view` (`client-portal-setup.tsx:49`), and every push-notification target.

### Design
Change the model from **allow-list-or-home** to **three explicit cases**:

1. **Pre-login public paths** (`PUBLIC_PATHS`) → pass through as-is with query intact. (unchanged)
2. **Known authenticated in-app paths** → return the real `'/' + cleaned` path. The app's auth gate handles the rest. Do **not** rewrite to Home.
3. **Genuinely unknown paths** → `'/'` (or `+not-found`), as today.

To distinguish (2) from (3) without hand-maintaining a second whitelist, derive the known-route set from the router surface the app already declares — reuse `utils/featureRegistry.ts` route ids and/or the `Stack.Screen` names in `app/_layout.tsx`. A path whose first segment matches a declared route is a known in-app path.

**Post-login replay (the other half):** passing an authenticated path through only helps if the auth gate remembers it. Today `app/_layout.tsx:498` does `router.replace('/login')` for unauthenticated users, discarding the target. Add a small **pending-deeplink** mechanism:
- When the gate redirects an unauthenticated user away from a non-public target, stash the intended path (in-memory + AsyncStorage key `mageid_pending_deeplink`, namespaced per existing convention; add to `LOCAL_USER_CACHE_KEYS` if user-scoped).
- After successful auth + onboarding completion, if a pending deeplink exists, `router.replace` to it and clear it.
- Guard: only replay in-app app paths (never an external URL); expire after a short TTL to avoid a stale link firing days later.

### Security note
Passing an internal path through is safe (it targets our own routes; unknown paths fall to `+not-found`). The replay only ever navigates to a validated in-app path, never an arbitrary URL — no open-redirect surface.

### Tests
`scripts/verify-deepLink.ts`: `mageid://qbo-setup` → `/qbo-setup`; `mageid://claim-crew?token=abc` → `/claim-crew?token=abc` (query preserved); `mageid://prequal-form` → unchanged public; `mageid://totally-unknown` → `/`; pending-deeplink set → replayed once → cleared.

---

## Piece 3 — Marketing plan/trial capture

### Problem
The marketing site's CTAs build `app.mageid.app/?plan=pro&trial=14` (and `?plan=free|business|enterprise`). Grep confirms **nothing** reads `plan`/`trial` on the auth/onboarding/paywall path (`_layout`, `login`, `signup`, `onboarding`, `onboarding-paywall`, `paywall`). The single most important funnel silently discards the visitor's chosen plan and trial intent.

### Design
Create `utils/signupIntent.ts` — a tiny persisted intent:
- On first web load (root), read `plan` and `trial` from the initial URL (`useLocalSearchParams` / `window.location` on web). Validate `plan ∈ {free,pro,business,enterprise}` and `trial` as a positive int.
- Persist to AsyncStorage (`mageid_signup_intent`) so it survives the login→signup→onboarding hops. Clear it once consumed or after onboarding completes.
- **Consume on the paywall** (`app/paywall.tsx` / `onboarding-paywall.tsx`): pre-select the intended tier's package and show the trial framing ("14-day free trial") when `trial > 0`. If `plan=free`, skip the hard paywall.
- **Activation is gated on RevenueCat.** This piece only pre-selects and frames; it does not start a real trial. When the RC webhook + real web key land (owner task), the existing purchase flow completes it. Note this boundary explicitly in-code.

### Tests
`scripts/verify-signupIntent.ts`: `?plan=pro&trial=14` → parsed `{plan:'pro', trialDays:14}`; invalid `plan=hacker` → ignored; persisted value survives a simulated reload and is cleared on consume.

---

## Piece 4 — Finish plan-intelligence cold-start rate caveat (small)

`utils/planIntelligence.ts:32-36` `DEFAULT_ROOM_RATES` (kitchen 250, bath 300, …) are invented cold-start rates. Render sites `app/plan-intelligence.tsx:102,378` "note this is a placeholder" but do not yet carry a proper grounding/`—` treatment for the cold-start case. Apply the `AIBidScorecard` pattern: when the rate is the default (no learned rate), show a **grounding chip** ("Market placeholder — MAGE has none of your rates yet") rather than presenting the derived dollar total as measured. Confirm current state and finish only what's missing. Small scope.

---

## Owner prerequisites (documented, NOT code in this spec)

These block a real paid launch but are account/store actions, not code:
1. **RevenueCat webhook + secrets** (`REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_SECRET_API_KEY`) configured, and the **web key swapped** from the sandbox `rcb_sb_…`. Until done, no purchase unlocks a tier — verify one real purchase end-to-end.
2. **Public App Store listing** live (privacy nutrition label, IAP products "Ready to Submit"), moving iOS off TestFlight-invite-only.

## Non-goals / explicitly deferred
- The **comprehensive** invented-numbers copy sweep (drawing-analyzer upsell deltas, cost-xray likelihood %, BidHitScoreboard benchmark, uncited "industry" stats). Deferred by decision #2.
- **Auto-starting** the RevenueCat trial from the URL (deferred by decision #3; blocked on RC config).
- Any new feature screen. Phase 1 subtracts and seals; it does not add surface.

## Testing & ship discipline
- Each engine util ships with a throwaway `scripts/verify-*.ts` harness (run with `bun`, deleted before commit) — the repo has no jest; validation is over pure functions per CLAUDE.md.
- `bun run typecheck` (strict, must be clean) + `bun run lint` + `bun run ship-check` before any PR.
- Keep app/server twins in sync where touched. No direct Supabase writes from UI (offline queue only) — none expected here.

## Risks
- **Bulk-savings type change** (`bulkSavingsTotal` optional/removed) ripples through seed files and the PDF generator; typecheck will surface every site — handle exhaustively.
- **Deep-link known-route derivation** must not misclassify a real route as unknown; prefer sourcing route ids from the single registry rather than a hand-typed list.
- **plan/trial on web vs native**: the param arrives via web URL on `app.mageid.app`; ensure the read works on web (primary) and degrades cleanly on native.
