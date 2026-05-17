# MAGE ID — Pre-Broad-TestFlight Hardening Audit (consolidated)

Date: 2026-05-17
Method: 4 parallel agents against shipped `main` (HEAD fb2219a) — (1) technical health/perf/crash-risk, (2) security/privacy/data-integrity, (3) money-spine correctness & cross-feature cohesion, (4) broad defect/regression sweep — plus a **live prod RLS verification** via Supabase MCP. Every finding has file:line. This is the "is it stable/secure/correct enough to widen TestFlight" pass; complements the prior UX/orientation/feature-depth audits.
Status: findings + ranked fix list + verified facts. Not yet implemented.

## Verdict (read first)

**Not yet — but the true blockers are a small, mostly-mechanical correctness/regression batch (~1 focused day), not the scary headlines.**

- **Security is far better than the code-only review implied.** A code agent flagged ~16 portal/financial tables as having "no RLS in version control." I verified against the live prod DB: **all 21 checked tables have RLS enabled with ≥1 policy** (projects/invoices/project_contracts have 6–8; portal_messages/lien_waivers/estimate_versions have 4). The real residual is **version-control hygiene** (policies live in the dashboard, not in `supabase/migrations/*` → not reproducible/reviewable), plus one targeted check on whether the anon portal-write policies are correctly scoped — **not** open cross-tenant data. This downgrades the headline P0 to P1.
- **The genuine blockers are correctness/regressions, and one is a direct gap in the work just shipped:** the F0 fix was wired into only 2 of ~17 money reads, so the lender-facing AIA G702 prints **$0 contract / negative balance** for every modern (linked-estimate) project; the showcase AI Drawing-Estimate flow dead-ends on a not-found route; the new Project Scope screen is unreachable after first use.
- The biggest *structural* risk (a 3,005-line god-context re-rendering ~86 screens on any write) is real and P1 — the "slow/janky after a week of real data" failure mode — but it's a large investment, not a same-day blocker.

## Verified facts (resolved uncertainty)

- **RLS prod state (queried `pg_tables`/`pg_policies`):** RLS enabled + policies present on ALL of: projects(8), invoices(8), project_contracts(6), selection_categories(5), portal_messages(4), lien_waivers(4), estimate_versions(4), bid_responses(3), portal_budget_proposals(3), portal_snapshots(3), selection_options(3), sub_submitted_invoices(3), change_order_approvals(2), aia_pay_apps(1), cois(1), commitments(1), financing_referrals(1), oac_meetings(1), permits(1), prequal_packets(1), warranties(1). No table is RLS-off.

## P0 — Must fix before widening TestFlight (small; ~1 day total)

| # | Finding | Where | Fix | Effort |
|---|---|---|---|---|
| H1 | **F0 only half-applied → lender-facing AIA G702 shows $0 / negative.** `aiaBilling.ts` reads legacy-only `project.estimate?.grandTotal` (null for every modern linked-estimate project) → "Original Contract Sum $0.00", negative "Balance to Finish" on a certified bank document. ~15 other hand-rolled `estimate?.grandTotal` reads also diverge (homeowner portal budget, public profile, client-view CO math show $0/CO-only). **Direct gap in this session's F0 work — it was scoped to only the 2 sites the prior audit named.** | `utils/aiaBilling.ts:125`; `utils/portalSnapshot.ts:426,644`; `utils/publicProfileSnapshot.ts:92`; `app/client-view.tsx:411`; +~10 more (`financialReports.ts:65,172`, `jobCostEngine.ts:156`, `closeout-binder.tsx:389`, `summary/index.tsx:103`, `change-order.tsx:100`, `invoice.tsx:145`, `(home)/index.tsx:112`, `closeoutPacketGenerator.ts:99`, `weekly-snapshot.tsx:216`) | Make `effectiveEstimateTotal(project)` the ONLY expression of the `linkedEstimate ?? estimate` ladder; replace all ~15 hand-rolled copies. Eliminates the bug class + prevents regression. | M (~1h) |
| H2 | **AI Drawing-Estimate dead-ends on a not-found route** (REGRESSION from this session's `commitEstimatePatch` refactor). After analysis it `router.push({pathname:'/estimate'})` — no `app/estimate.tsx` exists. Headline AI feature → blank "page not found." | `app/drawing-analyzer.tsx:192-194` | Route to `{ pathname:'/project-detail', params:{ id: pickedProjectId } }` (matches estimate-wizard); drop dead `hydratedFromAnalyzer` param. | S |
| H3 | **Project Scope screen orphaned** (REGRESSION). Reachable only via one NextStepHero card; once scope exists or a higher-priority card shows, the screen is unreachable — no tile/CreateMenu entry. Users funneled to "add scope" then can't find/edit it. | `app/project-scope.tsx`; `app/project-detail.tsx` (no scope tile); `components/CreateMenu.tsx` | Add a Scope tile to project-detail's tile grid (and/or a CreateMenu "Scope" scoped entry). | S–M |

## P1 — Before, or immediately after, widening

| # | Finding | Where | Fix | Effort |
|---|---|---|---|---|
| H4 | **RLS policies not in version control.** Verified present in prod, but ~16 tables' policies exist only in the dashboard — not reproducible/reviewable, at risk on any rebuild-from-migrations. Also: confirm the anon portal-write policies on `project_contracts`/`selection_options` are portal-scoped, not permissive-by-row-id (the portal counter-signs a contract via raw anon PATCH keyed on `contractId` — `marketing/portal/index.html:3238`; if the policy allows anon update-by-id, a leaked UUID = forgeable signature). | `supabase/migrations/*` (missing); inspect live `pg_policies` defs | Commit migrations mirroring the live RLS; dump+review each anon policy; move contract counter-sign / selection pick to a portal-token-validating service-role edge fn if the anon policy is by-id. | M |
| H5 | **`ProjectContext` god-context** (3,005 LOC, ~30 collections, ~200-entry value-memo dep array, consumed by ~86 screens). Any write (one photo) re-renders nearly the whole app; per-project photo array is fully RAM-resident and re-filtered every render. Degrades with real TestFlight data — the "janky after a week" failure mode. | `contexts/ProjectContext.tsx:2970,3004,99,2026` | Split into domain providers (financials/field/precon/docs) or separate stable actions from data; scope photo loading per project. | L |
| H6 | Schedule screen renders large lists via `.map()` in ScrollView (+ heavy Gantt mounted eagerly); offline queue unbounded + head-of-line; screen-level `JSON.parse` unguarded. | `app/(tabs)/schedule/index.tsx:944-1191`; `utils/offlineQueue.ts:34`; `bid-detail.tsx:153`, `invoice.tsx:167` | Virtualize schedule lists/lazy Gantt; cap+parallelize offline queue; safe-parse helper. | M |
| H7 | Estimate revisions persisted only in the `projects.estimate_versions` JSONB blob with no optimistic-concurrency guard; the buyout allowance→firm-price upsert (`ProjectContext.tsx:1850`) can clobber the revision array (silent history loss) and creates no revision (audit-trail gap). | `contexts/ProjectContext.tsx:1850,959`; `utils/estimateCommit.ts` | Add `updated_at`/version guard on the projects upsert path (or write revisions to the dedicated `estimate_versions` table); snapshot before the buyout in-place edit. | M |
| H8 | `financing-redirect`/`financing-callback` fully unauthenticated → referral-funnel/payout-attribution poisoning at scale (status inflation by replaying ids). Bounded (no data leak, no open-redirect) but corrupts analytics/partner attribution. | `supabase/functions/financing-redirect/index.ts:52-79`, `financing-callback` | Require the portal bearer token on portal-mode redirect; HMAC/shared-secret on partner callbacks. | M |

## P2 — Opportunistic

Cohesion/dead-code from rapid shipping: `KEEP_REASONS` lists `'sent_to_client'`/`'restore'` reasons never produced by any call site (orphaned enum + misleading commit message) `utils/estimateCommit.ts:9,35`; `?openCreate=1` dead fallback never read `CreateMenu.tsx:210`; CreateMenu "Permit" passes ignored `projectId` `CreateMenu.tsx:91`; no "estimate revised since contract" staleness badge; standardize on `expo-image`; `restore` snapshots droppable under the 30-cap (minor retention surprise).

## Recommended sequencing

1. **Ship the P0 hardening batch first (H1–H3, ~1 focused day, all OTA-able).** H1 is the priority — wrong money on a bank-facing document and a direct gap in the just-shipped F0 work; the fix is the mechanical "single accessor" sweep. H2 one-liner. H3 small. **This is the gate to widen TestFlight.**
2. **H4 next** (commit the RLS as migrations + verify/lock the anon portal-write policies) — security hygiene + the one residual real-exposure question.
3. **H5 (ProjectContext split)** as the next major investment — it's the structural ceiling on daily-use quality before this scales; large, deserves its own brainstorm→spec→plan.
4. H6–H8 as a stability pass; P2 opportunistically.
5. THEN resume feature-depth backlog (audit 2026-05-17-feature-depth): D1b GC-authored assemblies, D1c e-signable proposal, D2 payment reminders, D3 photo library/gallery, D4 real sub-risk gating.

Go/no-go: do not widen TestFlight until H1 (AIA/portal show real contract money) and H2 (AI drawing flow doesn't dead-end) are fixed; H3 strongly recommended same batch.
