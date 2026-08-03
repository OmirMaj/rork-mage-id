# MAGE ID — Full Product Audit (PM / CM / Owner)

**Date:** 2026-08-02
**Method:** 12 parallel agents, each reading real code in one dimension, plus direct verification
against the production Supabase database and the actual gate tables.
**Scope:** what has *not* been built (or is built and broken/unreachable) that stands between
MAGE ID and being the best construction app for PMs, CMs, and owners.

---

## The headline

**MAGE is far deeper than its marketing, its paywall, or its own UI copy admit — and it has a
small number of defects that are worse than any missing feature.**

The audit did not mostly find gaps. It found a large, genuinely impressive product with:

- QuickBooks Online **2-way sync** (OAuth, push, 30-min reconciler cron, staged cost-review queue)
- Full **CPM engine** with forward/backward pass, float, FS/SS/FF/SF + lag, per-task calendars,
  resource leveling with preview-and-apply
- Named **baselines** with compare, ghost-stripe overlay, as-built actuals
- **AIA G702/G703** pay applications with multi-period carry-forward and retainage
- 8-screen **safety suite** (JHA, toolbox, incidents with OSHA-recordable logic, OSHA-300 export)
- Prequal → COI vault (AI-validated) → buyout → A401 subcontract → sub portal → 1099 export
- A **prediction ledger that grades itself** and gates its own autonomy

And on top of that: a handful of things that are quietly wrong, and one existential strategic gap.

The single most valuable output of this audit is not a feature list. It is this: **several places
in the product state things that are not true.** That is the same disease just cured on the
marketing site, and it matters more here, because here a contractor acts on it.

---

## Tier 0 — Defects. Things that are wrong, not missing.

Ranked by damage. All four verified directly, not inferred.

### 0.1 — Photos never leave the device. **PROVEN IN PRODUCTION.**

`utils/storage.ts` exports `uploadProjectPhoto()`, which uploads to the `project-photos` bucket.
It is **never called anywhere** — `rg -n "uploadProjectPhoto"` matches only its own definition.
`contexts/ProjectContext.tsx:2780` writes the raw local `file://` path straight into the
`photos.uri` column.

Production evidence:

| bucket | objects |
|---|---|
| `project-photos` | **0 — ever** |
| `plan-sheets` | 7 |
| `rfp-attachments` | 5 |

`photos` table: 4 rows with `file://` (device-local), 5 with `https` (demo-seed stock URLs).

**Consequence:** every photo a user takes is invisible on any other device, after reinstall, on
the web app, and in the client portal. Photos are legal documentation in construction. The
metadata (GPS stamp, tag, markup) syncs perfectly, which makes the loss silent — the record
exists, the image is gone.

This is the same class of bug as the PDF 0-byte defect fixed in `537d74d`, and that fix already
put the correct primitive (`readFileBytes`) in place. The upload path is right. It is just never
invoked. **Status: fix dispatched.**

### 0.2 — The 3-week lookahead's weather is fabricated. Always.

`EXPO_PUBLIC_OPENWEATHER_API_KEY` is set in no `.env`, `app.json`, or `eas.json`.
Worse, `components/schedule/LookaheadView.tsx:195` calls `getSimulatedForecast()` **directly and
unconditionally** — it never attempts the real API at all. `getSimulatedForecast` is a
deterministic PRNG that ignores the `_region` parameter entirely, so the forecast has no relation
to the jobsite.

Nothing in the UI labels it as simulated.

**Consequence:** a GC reschedules a concrete pour, or flags a weather-sensitive task, based on
invented rain for a city the function never looked at. Weather-driven reschedules write real
entries to `weatherDelayLog` — which is the record you would later hand an owner to justify a
delay. Fiction is being logged as delay documentation.

### 0.3 — Change-order approval promises a schedule push it does not perform.

`app/change-order.tsx:694` tells the user: *"When approved, these days extend the project schedule
automatically."*

What actually happens on approval (`contexts/ProjectContext.tsx:1641`,
`app/project-detail.tsx:2546`) is only:

```
totalDurationDays += bumpDays
criticalPathDays  += bumpDays
bufferDays        += impactDays
```

**No task's `startDay` moves. No task is reflowed. CPM is never re-run.** The Gantt is byte-for-byte
unchanged. Two independent agents found this separately.

The cruelest detail: `AIChangeOrderImpact` already computes `affectedTasks[]` — which tasks shift
and by how many days — and renders it. That output is **thrown away**; nothing writes it back.

**Consequence:** the owner approves "+8 days," the contract says +8 days, and every sub still sees
the original dates. The schedule silently diverges from the contract on every approved CO, and
there is no baseline event recording when or why it moved — destroying the audit trail a delay
claim depends on.

### 0.4 — A Pro feature is unreachable by Pro users.

`app/portfolio-margin.tsx` is gated `portfolio_margin: 'pro'`. Its only navigation path is
Summary → **"Your Business"** → "Per-project view". But `app/business.tsx` is gated
`brain_accuracy: 'business'`.

**A Pro subscriber cannot reach a feature their tier entitles them to.** They are paying for a
screen with no door.

Related dead ends: `app/sub-profile.tsx` (registered `_layout.tsx:622`, zero inbound navigation —
a sub has no path to their own profile), `app/auto-bids.tsx` (registered, no inbound nav), and the
entire hire/messaging subsystem behind `HIRE_ENABLED = false` whose Supabase tables and Realtime
subscriptions still run on every app launch serving nothing.

### 0.5 — `subscribers[]` is collected and never read.

`ScheduleTask.subscribers[]` is editable in `TaskInspector` — a GC can add a sub's name, email,
and phone to a task. **No code ever reads that list.** Nothing sends anything, ever.

A GC who enters a sub's phone number reasonably believes that sub will be told when the task
moves. Nobody is told. This is worse than the feature not existing.

---

## Tier 1 — The strategic gap: the moat cannot deliver on day one

This is the most important finding in the audit, and it directly contradicts the marketing site.

**The entire product promise is "it learns your costs."** The cold-start path, traced through code:

1. New contractor signs up → persona → onboarding → demo seed → home. ~2–3 minutes.
2. They open the estimate wizard. `buildCostDatabase()` runs.
3. No closed jobs with actuals exist → `db.entries = []` → `groundingFacts = []`.
4. The estimate is generated **with zero personal grounding** — generic LLM pricing.

`utils/costDatabase.ts` blends with `w = n/(n+K)`, `K=3`. At 3 closed jobs the engine is 50%
personal. For a contractor running 3-month remodels, **meaningful differentiation is 6–18 months
away.**

And there is **no way to shortcut it**:

- No CSV / spreadsheet cost import (a contractor with 5 years of job-cost tabs in Excel cannot use them)
- No manual "here are my rates" entry — `utils/rateOverrides.ts` exists but is only wired into
  `app/(tabs)/estimate/full.tsx` via `RateOverrideModal`, not into onboarding or settings as a seed path
- No competitor migration (Buildertrend / JobTread / CoConstruct export)
- QuickBooks sync — the **only** bulk historical path — is gated at **Business $79/mo**, which a
  brand-new $29 Pro user does not have

**So the day-one experience of a 20-year contractor is identical to a first-day contractor.**

One honest thing already exists and deserves credit: the estimate result card correctly reads
*"Priced from market averages — close jobs to teach MAGE your real costs"* when grounding is empty
(`app/estimate-wizard.tsx:660`). But the loading step above it still says
*"Pricing from your history…"* (line 71) unconditionally — including when there is no history.

**Recommendation (highest strategic value in this document):** ship a cost-seed path for Pro —
paste-or-CSV historical job costs, and/or a "my rates" entry screen — and consider dropping QBO
sync to Pro. The moat is worth nothing to a user who churns at day 60 because it never got data.

---

## Tier 2 — Highest-value genuine gaps

Ranked by (impact to a PM/CM/owner) × (unfair advantage MAGE has).

| # | Gap | Why it matters | Effort |
|---|---|---|---|
| 1 | **T&M / extra-work field ticket with on-site signature** | Largest source of unbilled revenue in the trade. `SignaturePad` + offline queue + CO line types all already exist; only the screen is missing. | L |
| 2 | **Owner e-signature on change orders** | Portal CO approval is a `window.prompt()` for a name (`marketing/portal/index.html:5175`) — not ESIGN-compliant. Meanwhile the *contract* has drawn signature + `seal-document` + SHA-256 hash. Infrastructure exists; COs just don't use it. | S |
| 3 | **Superseded-drawing warning** | `superseded: true` is already computed and stored on every revision, and **nothing consumes it**. `plan-viewer` renders a stale sheet identically to a current one. Building from a superseded sheet is the #1 rework driver. **Status: fix dispatched.** | S |
| 4 | **Contingency drawdown tracking** | For remodelers this is *the* margin signal. Cost X-Ray already generates hidden-condition allowance lines — feeding those into a tracked contingency bucket closes a loop no competitor in this segment has. | S–M |
| 5 | **Structured cost codes (CSI)** | Phases are free-text: "Framing" and "framing" become two rows. Blocks bank/surety-grade reporting. The cost engine already accumulates by `trade\|unit` — mapping to CSI makes the personal cost book CSI-indexed, which Procore cannot do because it doesn't learn from you. | M |
| 6 | **Notice deadlines / claim windows** | Most contracts have 14–21 day written-notice clauses. Missing one waives legitimate time and money. Nothing tracks a notice clock. | M |
| 7 | **Submittal lead times** | `Submittal` has no `leadTimeDays` / `onSiteNeededDate`. 8-week tile lead time missed by a late approval is the most common residential schedule compression — and it's pure date arithmetic on data already captured. | M |
| 8 | **Calendar / day view** | The Calendar tab is a `TabComingSoon` placeholder. Field crews think in "what's Thursday," not Gantt bars. With MAGE's weather layer, a month grid tinting rain days is something Procore/Buildertrend don't do. | S–M |
| 9 | **Backcharge tracking** | Zero references anywhere in the codebase. Recurring silent loss on multi-sub remodels. | M |
| 10 | **Portfolio health on one screen** | The data all exists (`computeWIPReport`, `computeMarginRisk`, AR aging, schedule health) but is never joined. "Which job is bleeding?" is the Monday-morning question. | S–M |

---

### 0.6 — Multi-user is half-shipped: collaborators can't read anything but the schedule.

`20260728140000_project_collaborators.sql` (shipped 4 days ago) is real and well-built: a
`project_collaborators` table with `owner|editor|viewer`, a SECURITY DEFINER
`is_project_collaborator()` helper, a `project-invite` edge function with invite/accept/revoke/
changeRole, single-use tokens, and an accept flow that survives a sign-in round-trip.

**But `is_project_collaborator()` was only applied to the `projects` table** — SELECT and UPDATE.
Every sub-table policy is still owner-only:

- `co_select_own` (`schema.sql:776`), `rfis_select_own` (`:842`), `submittals_select_own` (`:848`)
- `daily_reports`, `invoices`, `punch_items`, `photos` — all `auth.uid() = user_id`

**Consequence:** invite a PM as `editor`, they accept, they sign in — and every query returns zero
rows except the project row itself. They can co-edit the schedule (the only screen that reads
`useProjectRole`) and nothing else. To a GC hiring their first PM, the collaboration feature will
look simply broken.

**Deliberately NOT auto-fixed in this pass.** Extending RLS is a production security change; an
over-broad policy leaks data across tenants, which is far worse than the current under-grant. This
needs a reviewed migration, table by table, with a verification query per table. It is the single
highest-value next task.

Two things fall out of this:

- **Markup exposure.** An `editor` collaborator can open the estimate and read every markup line.
  Invite a foreman to log daily reports and they can read your full margin structure. Foremen talk
  to subs. There is no role that grants field access without financial visibility.
- **The "Unlimited users" pricing claim** is now answerable: there is no company account, no seat
  billing, and no shared subscription — tier is keyed to a single `user_id`. Collaboration is
  per-project invites, gated at **Pro** (`schedule_collaboration`), not Business. Settings
  (`settings/index.tsx:1323`) advertises "Unlimited collaborators" as a *Business* feature, which
  contradicts the gate table.

### 0.7 — GC-side state changes write no audit trail.

`change_orders.audit_trail` (JSONB) and the `comm_events` table both exist with correct types.
The **only** code path that ever writes an audit entry is `client-view.tsx:445` (client portal
approve/reject). When the GC advances a CO draft → submitted → under_review → approved,
`change-order.tsx:548` calls `updateChangeOrder(id, { status: next })` and logs **nothing**.

Budget and estimate edits have no audit trail at all — no before/after, no actor, no timestamp.

**Consequence:** in a dispute over whether a CO was authorized or a budget line was edited after a
homeowner signed, there is no record to produce. Construction litigation runs on paper trails.
The primitives are already there; the critical paths just don't write to them.

---

## Tier 3 — Undersell: built, working, and hidden

The paywall comparison table (`app/paywall.tsx:40`) carries a **stale May-2026 comment** claiming
"SSO/SAML, Multi-tenant, Time tracking, and QuickBooks sync rows were removed entirely — those
features aren't built."

Two of those are now built and shipping:

- **QuickBooks Online 2-way sync** — 5 edge functions, 21KB setup screen, `_layout.tsx:1200`
- **Time tracking** — `app/time-tracking.tsx` is 50KB, real backend, offline-queued, CSV export

The paywall is the exact screen where a user decides to pay, and it is hiding the segment's #1
integration ask. `marketing/pricing.html` has the same problem in the other direction — it omits
every marquee Business feature (Cost X-Ray, Bid Advisor, Ask Your Plans, Track Record, Scan
Anything, Portfolio Margin) while describing Business as "org-level controls and accounting
integrations." **Status: pricing.html fix dispatched.**

Also siloed: `app/last-planner.tsx` (759 lines, real constraint log + PPC) reachable **only** from
the Tools tab — a PM living in schedule-pro will never discover it.

### Gate table vs. shipped code disagree in two places

Found while rewriting pricing. Both are the table being *stricter* than the code, so the site
under-promises rather than over-promises — the safe direction, but they should be reconciled:

- **`plan_viewer` is an orphan key.** Nothing reads it. `app/plan-viewer.tsx` deliberately gates on
  `plan_markup` (**Pro**), with a comment explaining it was moved down because "a paying Pro user
  who imported drawings hit a Business paywall the instant they opened a sheet." So sheet pinning
  is *actually Pro* in shipped code while `REQUIRED_TIER` says business.
- **`app/closeout-binder.tsx` has no tier gate at all**, despite `punch_list_closeout: 'business'`.

Two stale code comments in the same family: `app/auto-bids.tsx` and `app/win-optimizer.tsx` both
say "Pro-gated" but their keys (`bid_scoring`, `portfolio_margin`) are `business`.

### Two more fabricated marketing claims (fixed in this pass)

- `features/financials.html:360` claimed **"One-click IIF / CSV export to QuickBooks Online,
  Desktop, or Xero."** There is no IIF export and no QuickBooks Desktop path anywhere in the
  codebase. Rewritten to describe the real QBO 2-way sync + Xero CSV.
- `pricing.html` claimed CSV export to **"Sage / Foundation"** — neither string exists anywhere in
  the codebase. Fabricated. Removed.
- `features/vs-competitors.html:672` was honestly admitting "native sync is on the roadmap" — true
  when written, now outdated since QBO 2-way sync shipped. Updated, while keeping the honest
  admission that Desktop / Sage 300 / Vista shops are still better served elsewhere.

---

## What was fixed in this pass

1. **Superseded-drawing warning** (0.3 / Tier 2 #3) — non-dismissible banner in `plan-viewer` with a
   jump to the live sheet, plus an unmissable marker on superseded rows in `plans`. Backed by a
   pure `utils/planRevisionCore.ts` and 50 assertions in `scripts/validate-plan-revisions.ts`,
   mutation-tested (removing each guard produced failures). "Current" resolves forward by *state*,
   not by following `previousSheetId` — that chain points newer→older and breaks if a middle row is
   deleted. Ambiguous (two live heads, from an offline race) and not-found both still warn but
   render **no jump button** rather than guessing; the cost of routing someone to the wrong sheet
   is a framed wall. Found and fixed a pre-existing bug in passing: the old rev pill was gated on
   `revision > 1`, so **the original superseded sheet — the copy already printed and taped to the
   trailer wall — had no marker at all.**
2. **`marketing/pricing.html`** — rewritten against `REQUIRED_TIER`. Business now leads with the
   brain; three mis-tiers corrected; **"Unlimited users" removed as false** (no org, no seats, no
   team logins exist); fabricated "Sage / Foundation" and "IIF / QuickBooks Desktop" export claims
   removed; the real QBO 2-way sync described accurately instead of as "CSV export."
   `scripts/validate-marketing-claims.ts` extended to 31 assertions covering pricing tier blocks,
   with the mis-tier rules **derived from `REQUIRED_TIER`** so a legitimate re-tier retires the rule
   instead of freezing a stale one. Negative-tested: reintroducing all five defects produced 5
   failures and exit 1.
3. **Two more fabricated marketing claims** in `features/financials.html` and
   `features/vs-competitors.html` (see above).
4. **Orphan navigation** — `home-passport` and `widget-setup` added to `DesktopSidebar`; both were
   fully built and reachable only via Cmd-K search.
5. **In-product false claim** — the estimate wizard's loading copy said *"Pricing from your
   history…"* unconditionally, including when the cost book is empty. Now branches on
   `groundingFacts`, matching what the result card already stated honestly.
6. **Settings tier list** — was selling `client_portal` and `schedule_collaboration` (both **Pro**)
   as Business features; replaced with what Business actually unlocks.
7. **Photo upload** (0.1) — in progress at time of writing; see the note below.

## Recommended next, in order

1. **Extend collaborator RLS to sub-tables** (0.6) — reviewed migration, one table at a time, with a
   verification query each. Multi-user is advertised and currently inoperable.
2. **Cost-seed path for Pro** (Tier 1) — the moat is inert without it; this is the churn risk.
3. **Weather** — label simulated data or suppress it. Never write fiction into `weatherDelayLog`.
4. **CO → schedule reflow**, using the `affectedTasks[]` the AI already computes. Fix the false
   copy at `change-order.tsx:694` either way — today it promises something that does not happen.
5. **Audit trail on state changes** (0.7) — DB triggers are more reliable than app-layer hooks
   because they catch every write path.
6. **Un-gate `/portfolio-margin`** for Pro users, and un-orphan **Home Passport** — the latter is a
   pure nav addition to `DesktopSidebar.tsx` for a fully-built, genuinely differentiating feature
   that no competitor offers and that currently only surfaces via Cmd-K search.
7. **T&M field ticket** with on-site signature — largest unbilled-revenue recovery available.

Two one-line wins worth doing immediately: map `SelectionCategory.dueDate` into
`buildPortalSnapshot()` (the field is stored but never reaches the portal, so owners can't see the
deadline they're missing), and fix the `settings/index.tsx:1323` "Unlimited collaborators —
Business" copy to match the Pro gate.

---

## Method note

Findings were verified, not assumed. Where an agent's claim was checkable, it was checked —
against the production database, the gate tables, or the code. **Four agent claims were wrong and
are excluded from this document:**

- "The `commitment.paidToDate` trigger may not exist" — it **does**:
  `sub_invoice_recompute_commitment` → `recompute_commitment_paid_to_date`, confirmed in production.
  A whole "committed cost is inaccurate" finding rested on this and evaporated.
- "`budget-dashboard` may be unreachable" — reachable via `project-detail.tsx:3252` and
  `DesktopSidebar.tsx:118`; a second agent checked more carefully than the first.
- "There is no accounting export" — there are two: live QBO 2-way sync, and QBO/Xero CSV.
- "Resource leveling is missing" — it is fully shipped, engine (`utils/cpm.ts:810`) through
  preview-and-apply UI (`LevelingPreviewModal.tsx`).

This is the reason the audit ran 12 independent readers rather than one: the disagreements were
where the truth was.
