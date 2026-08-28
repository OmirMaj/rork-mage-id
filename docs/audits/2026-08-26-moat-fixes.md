# Moat fixes — 2026-08-26

Response to the "What MAGE ID Is Missing" strategic critique. Four systemic
fixes shipped (OTA-safe, verified); two need a founder decision before anyone
builds them. Each fix was re-checked against the code before building — where
the critique's suggested mechanism assumed data or plumbing that doesn't exist,
the fix was reshaped to the same GOAL with a mechanism the codebase supports.

---

## Shipped (OTA-safe, verified — held for your go on `eas update`)

### 1. Labor-burden guardrail — `utils/laborBurdenModel.ts`
**Critique:** the cost book learns labor from entered $/hr rates; a GC who types
a bare wage (no burden) silently teaches it to bid labor 25–48% low.
**What we did NOT do:** auto-multiply rates by a burden factor. The UI already
asks for a *loaded* rate, so multiplying would double-count for anyone who
followed instructions, and true burden varies by state/carrier/trade.
**What we did:** a non-blocking nudge in the rate-entry UI (`time-tracking.tsx`)
when a rate looks like a bare wage for that trade, plus per-trade burden
reference (roofing ~48% … landscape ~26%). Detect-and-nudge, never overwrite.
Pinned by `test:labor-burden`.

### 2. Variance decomposition — `utils/varianceDecomposition.ts`
**Critique:** `actualUnit = cost/quantity` conflates price, productivity, scope,
and weather — one blown job poisons the learned rate forever.
**What we found:** a full causal decomposition needs per-line change-order and
weather linkage that does not exist today (untraced CO dollars are already
excluded upstream; weather lives at the schedule level). Building that blind
would risk the financial core.
**What we did:** robust outlier rejection (median/MAD). Price and productivity
vary continuously (kept — they're the real signal); scope/weather blowouts land
as discrete outliers and are rejected from the learned rate, kept visible to the
GC ("one-off · not in rate"). Conservative: no-op below 4 samples, never rejects
a majority, never mutates shared inputs. `costDatabase.ts` now learns the rate,
variability, bias, and job count from clean samples only. All 482 existing
cost-engine assertions still pass; pinned by `test:cost-variance-decomposition`.

### 3. Win-Optimizer de-bias — `utils/winOptimizer.ts`
**Critique:** the win curve is calibrated on censored data (you only see outcomes
at the prices you actually bid), which biases the recommendation cheaper.
**What we did:** a **censoring floor** — the default recommendation can't dip
below the GC's own typical markup unless there's real, ample price-loss evidence
(confidence-gated). Plus an **honest band** (the optimum is a markup range, not a
razor's edge, widening as confidence drops) and a driver that names the
limitation out loud. The "aggressive/price-to-win" option may still undercut the
floor — it's the explicit ask. Pinned by `test:win-optimizer-debias`.
**Deferred to server:** knowing the *winning competitor's* price on a loss (the
true counterfactual) needs new Lead columns — see decision #6.

### 4. Field-only role — `utils/roleBlinding.ts`, `components/LockedAccessCard.tsx`
**Critique:** no role lets a foreman/sub onto a job without also handing them the
margins — so crews stay off the platform, starving the moat of field data.
**What we did:** a `'field'` collaborator role (assignable in the invite UI) with
a single pure gate, `canViewFinancials`, that **fails closed** (null role →
blinded, so a margin never flashes while the role resolves). Applied to the
project money-hero (`ProjectHero`) and the whole job-costing screen; blinded
surfaces show `LockedAccessCard`. Pinned by `test:role-blinding`.
**Scope honesty:** this is client-side defense-in-depth and a trust signal, NOT
the security boundary. Row-level enforcement is decision #6.

---

## Decided + shipped

### 5. Accounts-payable — **founder chose reconciliation-only** ✅ BUILT
MAGE does **not** move money and will not become a payment processor. "Mark
paid" now records the payment the GC made elsewhere so paid-vs-owed reconciles
against a bank statement.
- `supabase/migrations/20260826120000_ap_payment_reconciliation.sql` — additive,
  idempotent, nullable: `payment_method` (CHECK-constrained vocabulary, NOT
  VALID so legacy rows don't block), `payment_reference`, `paid_on` (**date**,
  partial-indexed). `paid_on` is deliberately distinct from `paid_at`: a check
  written Friday and logged Monday must reconcile to *Friday's* statement.
- `utils/apReconciliation.ts` — `reconciliationState` → `not_applicable` /
  `unreconciled` / `partial` / `reconciled`. Cash and "other" need no reference;
  check/ACH/card do. A junk method string does not count as a record.
- `components/RecordPaymentModal.tsx` — capture sheet, **skippable** ("Mark
  paid, add detail later") so a GC in a supply yard isn't blocked. Uses a
  local-date helper, not `toISOString()`, which would UTC-shift an evening check
  to the next day.
- `app/sub-portal-setup.tsx` — paid cards show the payment line
  ("Check · #1042 · Mar 3, 2026") or an honest "No payment detail" + **Add
  detail**, so pre-existing paid rows have a path to reconcile.
- **Correction path does not re-stamp `paid_at`** (`reconcileOnly`) — otherwise
  typing a check number later would overwrite when the payment was actually
  recorded and corrupt the audit trail.
- Pinned by `test:ap-reconciliation` (30 assertions).

**Deployment order:** the migration should be applied **before** the OTA. If the
OTA lands first, the offline queue classifies the PGRST204 schema-cache miss as
transient and re-queues the write unchanged (no retry budget burned), so it
self-heals — but applying first avoids the delay entirely.

---

## Needs a founder decision (NOT built)

### 6a. Field-role RLS — ✅ BUILT (migration pending apply)
**Correction to the original critique.** It claimed financial tables were
exposed to collaborators. Verified against **live `pg_policies` on 2026-08-26**:
they are not. `invoices`, `change_orders`, `commitments`, `aia_pay_apps`,
`lien_waivers`, `draw_periods`, `wip_periods` are **all owner-only**
(`auth.uid() = user_id`). No collaborator of any role — editor or viewer
included — can read them. That part of the critique was wrong.

**What was actually broken:** the `field` role shipped in fix #4 was
**non-functional end-to-end**. Two server-side blockers, both found by reading
the live schema rather than the migration files:
1. `project_collaborators_role_check` — `role in ('owner','editor','viewer')`.
   Every field invite was rejected by the database.
2. `project-invite` edge function — `ROLES = {owner, editor, viewer}`, a 400
   before the insert was even attempted.

`supabase/migrations/20260826130000_field_role.sql` fixes both plus the tier
semantics: `can_access_project` / `is_project_collaborator` gain a **`'field'`
tier** (`owner, editor, field`) sitting between `editor` and `viewer`, and the
8 field-table write policies move from the `editor` tier to it — otherwise a
foreman could open a daily report and not save it, which is the whole point of
the role. Policy names and the constraint name were verified against live
`pg_policies`/`pg_constraint` first, so the drop+create replaces cleanly rather
than leaving the duplicate-policy sprawl the 2026-08-03 migration warned about.

**Residual leak, stated honestly.** Field users need `projects.schedule`, and
`projects_select` is `auth.uid() = user_id OR is_project_collaborator(id)` — so
a field collaborator can read the whole `projects` row, including the financial
jsonb columns `estimate`, `linked_estimate`, `target_budget`,
`estimate_versions`. **Postgres RLS is row-level and cannot blind columns**;
column GRANTs apply per database role and every app user is `authenticated`, so
they can't distinguish collaborators. Closing it needs either:
- **(a)** splitting those jsonb columns into a `project_financials` table with
  its own owner+editor policy, or
- **(b)** denying field users `projects_select` and serving them a safe view.

**Founder chose (a): split into `project_financials`.** ✅ BUILT — see 6c.
Write access was never at risk — `projects_update` already requires the
`editor` tier, so a field user could not overwrite the estimate.

### 6c. project_financials split — ✅ BUILT, ships in 2 phases
Money (`estimate`, `linked_estimate`, `estimate_versions`, `target_budget`)
moves off the `projects` row into `project_financials`, whose SELECT policy is
`owner | editor | viewer` — **`field` excluded**. `scope` deliberately stays on
`projects`: scope-of-work is operational and the crew needs it.

`can_view_project_financials()` is its own function rather than a rung on
`can_access_project`'s edit ladder — "may see money" is a different question,
and folding it in would mean a future widening of the ladder silently widens
financial access.

**Two phases, and phase 1 alone does NOT close the leak.** Phase 1 creates,
backfills, and secures the table but *keeps* the legacy columns, because a
build that reads `projects.estimate` and finds the column gone renders every
estimate blank — indistinguishable from data loss. The client dual-writes and
reads new-first-with-legacy-fallback, so it is correct on either schema.

    1. apply 20260826140000_project_financials_split.sql
    2. ship the OTA
    3. open the app, confirm estimates/budgets still render
    4. apply 20260827120000_project_financials_drop_legacy.sql  ← leak closes

The phase-2 migration **refuses to run** (`raise exception`) if any project
still holds money with no `project_financials` row, and tops up stragglers with
`coalesce` so it never overwrites a newer value with a staler legacy one.

**Guarded:** `test:project-financials-split` fails the build if a write path
touches a financial column on `projects` without a paired `project_financials`
write (the failure mode that would strand money on the legacy row right before
phase 2 deletes it). The guard was **negative-tested** against a mutated copy —
it catches both write sites — rather than merely observed passing.

### 6b. Per-seat pricing + iPad Gantt (still open)
- **Per-seat:** tiers are per-account, so a GC adding their whole crew as field
  users pays the same — caps net revenue retention. A per-seat add-on (via
  RevenueCat) would let crew growth grow revenue. Needs a price point from you.
- **iPad Gantt:** the schedule Gantt is web-only ≥900px; `ios.supportsTablet` is
  false. Takeoff + plan-viewer are already responsive. A narrow-Gantt pass +
  enabling tablet is a bounded chunk if iPad-on-site matters to you.

---

## Verification
`npx tsc --noEmit` clean · `test:app-slop`, `test:brand-orange`, `test:collab`,
`test:cost-truth`, `test:cost-seed`, `test:labor-samples`, `test:job-cost`,
`test:takeoff-pricing` all pass · 4 new validators green · no new npm
dependencies (reanimated absent → native surface unchanged → OTA-safe).
