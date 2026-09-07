# 2026-09-04 — Final-push fixes: execution plan

Source: `docs/audits/2026-09-03-final-push-audit.md` (fix order, waves 0–3).
Branch: `claude/final-push-fixes`. Implementers work in this checkout on
strictly disjoint file sets; the coordinator commits per phase after
`bun run ship-check`. Nothing here deploys, applies a migration, pushes, or
builds — those are listed at the end as owner-gated steps.

Shared helpers created up front (import, do not duplicate):
- `supabase/functions/_shared/portalLinks.ts` — `portalUrlFor(client_portal)`, `subPortalUrlFor(link)`.
- `utils/invoiceBilling.ts` — `invoiceOutstanding(inv)`, `invoiceIsSettled(inv)` (+ existing `netBalanceDue`).
- `utils/platformFees.ts` — `PLATFORM_FEE_BPS`, `platformFeeLabel`, `platformFeeCents`, `estimateNetAfterFees`.

Rules for every task: write the failing test/guard first where a pure function exists;
keep behaviour changes minimal and explained in a comment that names the audit ID;
do not edit files outside your set; do not touch `package.json` (the coordinator
wires new `test:*` scripts); do not commit.

## Phase 1 (parallel, file-disjoint)

- **A1 · edge auth & notifications** — files: `supabase/config.toml` (new), `supabase/functions/notify/index.ts`, `supabase/functions/invoice-dunning/index.ts`, `supabase/functions/portal-link-expiry-notice/index.ts`, `supabase/migrations/20260904100000_notify_trigger_cron_secret.sql` (new), `scripts/validate-edge-verify-jwt.ts` (new). Audit: EDGE-F1/F2/F3/F4/F5/F6, DB-F1, OPS-F2/F3.
- **A2 · Stripe money loop** — files: `supabase/functions/create-payment-link/index.ts`, `supabase/functions/stripe-webhook/index.ts`, `supabase/migrations/20260904100100_pay_links_and_aia_paid.sql` (new), `scripts/validate-platform-fees.ts` (new). Audit: MONEY-F2/F16/F17, EDGE-F8, MONEY-F8 (server half).
- **A4 · database security migrations + account deletion** — files: `supabase/migrations/20260904100200_*.sql` (new, several), `supabase/functions/delete-account/index.ts`, `scripts/validate-account-deletion.ts`, `scripts/validate-role-tiers.ts` (new). Audit: DB-F2 (re-verify the 08-26 migration), DB-F5/F7/F8/F9/F10/F13, CONTRACT-F1/F4, AUTH-F1/F7/F8, EDGE-F13.
- **B1 · ProjectContext + root layout** — files: `contexts/ProjectContext.tsx`, `app/_layout.tsx`. Audit: MONEY-F3 (tax coercion), MONEY-F1 (AIA mapper), AUTH-F2 (legacy fallback for owned rows only), AUTH-F5 (strip portal credentials from collaborator rows), SYNC-F3 (local-only merge + post-flush invalidation), SYNC-F14 (await projects before financials), SYNC-F7 (flush pending syncs on background — expose `flushPendingProjectSyncs()`), PRODUCT-F1 (COI vault → sub `coiExpiry`), MONEY-F5 (`:2539` uses `invoiceOutstanding`), UX-F14 (`gestureEnabled:false` on estimate-wizard/quick-quote/judges), UX-F18 (`unstable_settings.initialRouteName`).
- **B2 · offline queue, auth, session** — files: `utils/offlineQueue.ts`, `contexts/AuthContext.tsx`, `lib/supabase.ts`, `app/(tabs)/settings/index.tsx`, `hooks/usePortalThread.ts`, `app/client-messages.tsx`, `hooks/usePortalBudgetProposals.ts`, `scripts/validate-offline-group-abort.ts`, `__tests__/sync/offline-queue.test.ts` (new). Audit: SYNC-F1/F2/F4/F6/F8/F13, HEALTH-F10, RT-R1 (dead-session handling), OPS-F13 (Settings › About row with version/OTA id), AUTH-F17 (`Purchases.logOut`).

## Phase 2 (parallel, file-disjoint)

- **A3 · edge hardening & AI** — files: the eight decode-only functions (`connect-onboarding`, `connect-status`, `create-rfp-checkout`, `project-invite`, `send-email`, `schedule-ical-url`, `transcribe-audio`, and `award-rfp` verify), `convert-pdf-to-images`, `ai`, `_shared/embeddings.ts`, `project-memory-embed`, `project-memory-search`, `portal-ask-home`, `analyze-photos`, `homeowner-weekly-digest`, `_shared/email.ts` (unsub secret), `schedule-ical`, ten metered functions (charge-after-success). Audit: EDGE-F7/F9/F11/F14, AI-F1/F8/F11/F13, OPS-F11, AUTH-F4 (digest portal link via helper), AUTH-F16.
- **B3a · invoice / retention / PDF / fees / 1099** — files: `app/invoice.tsx`, `app/aia-pay-app.tsx`, `app/retention.tsx`, `app/payments.tsx`, `app/payments-setup.tsx`, `app/paywall.tsx` (fee row only), `utils/stripe.ts`, `utils/pdfGenerator.ts`, `utils/cashFlowEngine.ts`, `utils/tax1099Export.ts`, `app/tax-1099-export.tsx`, `utils/financialReports.ts`, `utils/projectFinancials.ts`, `utils/portalSnapshot.ts`, `utils/weeklyClientUpdate.ts`, `utils/weekClose/composeWeekClose.ts`, `utils/brainWatch.ts`, `utils/portfolio/clientBook.ts`, `utils/aiService.ts`, `components/CashFlowAlerts.tsx`, `components/NextStepHero.tsx`, `app/cash-flow.tsx`, `app/change-order.tsx`, `scripts/validate-money-outstanding.ts` (new), `scripts/validate-invoice-billing.ts` (extend/new). Audit: MONEY-F4/F5/F6/F7/F8/F13/F18, HEALTH-F5.
- **B3b · job cost / WIP / estimate math / cost seeds / OT** — files: `utils/wip.ts`, `utils/livingEstimate.ts`, `utils/jobCostEngine.ts`, `utils/laborSamples.ts`, `hooks/useTimeEntries.ts`, `hooks/useLaborRates.ts`, `utils/costSeedCore.ts`, `hooks/useCostSeeds.ts`, `contexts/CompaniesContext.tsx`, `contexts/HireContext.tsx`, `app/bill-from-estimate.tsx`, `scripts/validate-wip.ts`, `scripts/validate-estimate-cost-basis.ts`, `scripts/validate-cost-seed.ts`. Audit: MONEY-F10/F11/F14/F19, CONTRACT-F2/F3.
- **B4 · dates, dead ends, reachability, product wiring** — files: `app/(tabs)/(home)/index.tsx`, `app/(tabs)/summary/index.tsx`, `app/daily-report.tsx`, `components/schedule/mobile/{MobileScheduleScreen,MonthCalendarSheet,ExportCenterSheet}.tsx`, `utils/scheduleOps.ts`, `app/shared-schedule.tsx`, `app/lien-waivers.tsx`, `app/permits.tsx`, `app/warranties.tsx`, `components/schedule/tabs/{BoardTab,DashboardTab}.tsx`, `components/schedule/{TodayView,LookaheadView}.tsx`, `components/SubDailyUpdateModal.tsx`, `components/schedule/SubUpdatesPanel.tsx`, `app/submit-bid-response.tsx`, `app/job-costing.tsx`, `components/ProjectHero.tsx`, `hooks/useProjectRole.ts`, `utils/entityResolver.ts`, `hooks/useEntityNavigation.ts`, `components/ToolScreenChrome.tsx`, `hooks/useSafeBack.ts` (new), `app/rfp-detail.tsx`, `app/deliveries.tsx`, `app/building-access.tsx`, `app/report-inbox.tsx`, `app/(tabs)/discover/tools.tsx`, `app/project-detail.tsx` (tile grid only), `components/summary/ToolsSheet.tsx`, `utils/featureRegistry.ts`, `app/integrations.tsx`, `contexts/NotificationContext.tsx`, `app/(tabs)/mage-id-bids/index.tsx` (nearby entry gate), `scripts/validate-calendar-date.ts` (rewrite), `scripts/validate-feature-search.ts` (extend). Audit: UX-F1–F11, F15–F18, RT-R2, PRODUCT-F2/F4/F8, UX-F7.
- **B5 · AI client honesty + Brain Watch** — files: `app/(tabs)/construction-ai/index.tsx`, `app/estimate-wizard.tsx`, `app/(tabs)/estimate/full.tsx` (rateCount only), `components/AIQuickEstimate.tsx`, `utils/copilot/estimateEdit/interpretEstimateOps.ts`, `components/home/BrainWatchCard.tsx` (+ its data hook), `scripts/validate-copilot-estimate-edit.ts`. Audit: AI-F3/F4/F5, PRODUCT-F18, RT-R1 (UI half).

## Phase 3 (coordinator)
- C1 hygiene: remove dead files/deps, stale cron SQL, `DEPLOY-NOW.sql` cron/column blocks, `package-lock.json`, root junk; wire every new `test:*` into `package.json`; `bun run ship-check`; runtime checks in the simulator; commits.

## Owner-gated (NOT done here)
Deploy edge functions (with the flags in `supabase/config.toml`); apply the new
migrations; `git push`; native build #15 + OTA; RevenueCat secrets; Supabase plan;
delete `sync-bids`/`fetch-material-price`; Netlify deploy of the portal fix.
