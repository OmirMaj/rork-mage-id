# product connection — final-push audit — 2026-09-03

Domain: where features exist but do not talk to each other, cannot be reached, or are
half-wired. The prior 14-surface PM-brain audit's verdict was "the gap is connection, not
capture"; this pass measures that verdict against today's code, path by path.

Verdict up front: the verdict still holds, but it has moved. Capture is now broad
(187 routes, ~200 domain fields) and most of the *money* spine is wired —
lead→project, estimate→contract→invoice, buyout→commitment, CO→contract sum,
CO→schedule reflow, closed job→cost book→AI grounding. What is still disconnected is
(a) the *actuals* side of the moat — nothing lets a GC record a sub payment outside
the sub portal, so calibration, 1099 and lien waivers are blind for most small GCs;
(b) the same job-cost number computed with different inputs on five screens;
(c) iOS, the primary platform, has no entry point for six shipped features
(including the marketed "chase list" and the 09-02 Deliveries batch); and
(d) three "silent success" classes: COI reminders that cannot fire, QuickBooks pushes
that fail invisibly, and push notifications whose tap does nothing.

## Scope covered (files/paths actually read; commands run)

Repo read-only; no production SQL was needed (schema.sql, regenerated today, answered
every DB question). Tools written under
`scratchpad/audit/tools/` only:

- `tools/reachability.py` — enumerates every route file under `app/` (204 files, 187
  routes after `_layout`/`+*` are dropped), greps quoted route literals across
  `app/ components/ utils/ hooks/ contexts/ lib/`, classifies each inbound reference by
  source (iOS tabs layout, DesktopSidebar, project-detail tile grid, home, discover,
  search registry, deep-link/entity resolver, notifications, create menu). Output:
  `out/reachability.txt`, `out/reachability.json`. Template-string navigation was
  hand-checked (`router.push(item.route)` sites in summary/ToolsSheet, brief,
  week-close, report-inbox, handover, CopilotShell, NextStepHero, OnboardingChecklist,
  Tutorial, BrainWatchCard — all draw from literal lists that the grep covered).
- `tools/dead_fields.py` — parses 38 interfaces in `types/index.ts`, counts read-shaped
  (`.field`) vs write-shaped (`field:`) references outside types/mocks/dev seeders.
  Output: `out/dead_fields.txt`; every candidate cited below was hand-verified.

Files read end to end or in the relevant ranges: `app/(tabs)/_layout.tsx`,
`components/DesktopSidebar.tsx`, `app/(tabs)/discover/{index,tools}.tsx`,
`components/summary/ToolsSheet.tsx`, `components/CreateMenu.tsx`, `utils/featureRegistry.ts`,
`utils/{deepLinkScheme,pendingDeepLink,entityResolver}.ts`, `app/+native-intent.tsx`,
`contexts/NotificationContext.tsx`, `hooks/useNotificationFeed.ts`, `utils/notifyClient.ts`,
`supabase/functions/notify/index.ts`, `supabase/functions/{award-rfp,notify-nearby-contractors,
coi-expiry-watch,stripe-webhook,qbo-reconciler,daily-digest,morning-digest,invoice-dunning,
portal-link-expiry-notice}/index.ts`, `supabase/schema.sql` (triggers, `fire_notify`,
`award_rfp`, `recompute_commitment_paid_to_date`, portal RPCs), `utils/jobCostEngine.ts`,
`utils/laborBurdenModel.ts`, `hooks/{useTimeEntries,useLaborRates,useCostBenchmark,
useSubSubmittedInvoices,usePortalApprovalReconciler}.ts`, `utils/{estimateActuals,costDatabase,
costTruth,rateProvenance,estimateCommit,projectFinancials,contractEngine,aiaBilling,
invoiceBilling,billingFlowCore,deliverySchedule,noticeClock,weatherReschedule,lienWaiverEngine,
tax1099Export,prequalEngine,scheduleEngine,scheduleOnRamp,estimateHubEntries,subPortalSnapshot,
financialReports,wip,marginRiskScore,livingEstimate,portalSnapshot}.ts`,
`utils/automation/inspectionResultToScheduleWork.ts`, `app/{change-order,invoice,aia-pay-app,
bill-from-estimate,job-costing,daily-report,deliveries,delay-events,closeout-binder,
punch-list,coi-vault,prequal-manager,buyout,buyout-package,lead-detail,nearby-rfps,
rfp-detail,integrations,documents,waiting-on,estimate-wizard,quick-quote,takeoff-estimate,
schedule-pro,schedule-wizard,schedule-builder,sub-portal-setup,notifications-inbox}.tsx`
(targeted ranges), `app/(tabs)/estimate/full.tsx` (math sites), `app/(tabs)/schedule/index.tsx`
(gates, persistence), `contexts/ProjectContext.tsx` (mappers, `awardBidPackage`, `addCOI`,
delay-event writes), `contexts/HireContext.tsx`, `components/ClientPaywall.tsx`,
`utils/seatModel.ts`, `hooks/useTierAccess.ts`, `utils/featureTiers.ts`,
`supabase/functions/_shared/auth.ts` (MONTHLY_CAPS), `app/paywall.tsx` (AI_LIMITS),
`marketing/index.html`, `marketing/pricing.html`, `marketing/portal/index.html` (notify calls),
`marketing/sub-portal/index.html`, `scripts/validate-marketing-claims.ts`,
`scripts/validate-co-{approval-sync,schedule-reflow}.ts` (headers), the two closed audit docs
(headings + #1–#5 of launch-readiness) and the START-HERE banner.

### Method 1 — Reachability (187 routes)

Zero inbound references (4): `/accept-invite`, `/integrations/qbo/callback`,
`/shared-estimate`, `/shared-photos` — all are link-entry routes whose URLs are built
elsewhere (`project-invite/index.ts:259`, `qbo-connect-*`, `estimate/review.tsx:229`,
`project-detail.tsx:1070`). Same for `/claim-crew`, `/prequal-form`, `/reset-password`,
`/shared-plan`, `/shared-schedule` (routeTitle-only). Not defects.

Reachable ONLY from the web sidebar and/or the search registry (i.e. on iPhone, only via
Universal Search — the sidebar mounts only when `layout.showSidebar`, and the hidden tabs
carry `href: null` at `app/(tabs)/_layout.tsx:146-154, 244-251`):

| route | inbound (all of it) | note |
|---|---|---|
| `/waiting-on` | DesktopSidebar:63, featureRegistry:130 | the homepage "chase list" |
| `/deliveries` | DesktopSidebar:127, featureRegistry:229, systemOfAction:191, brainWatch:218 | the last two are item links that exist only once a delivery exists — nothing on iOS creates one |
| `/equipment` (hidden tab) | DesktopSidebar:129, featureRegistry:221 | |
| `/marketplace` (hidden tab, "Suppliers") | DesktopSidebar:80, featureRegistry:162 | |
| `/auto-bids` ("Pre-priced Bids") | DesktopSidebar:83, featureRegistry:158 | |
| `/home-passport` (GC side) | DesktopSidebar:151, featureRegistry:129 | marketed as a closing pitch |
| `/widget-setup` | DesktopSidebar:90, featureRegistry:127 | |
| `/integrations` | featureRegistry:248 only | a MOCK screen — see F2 |
| `/sub-profile` | featureRegistry:128 only | both platforms |
| `/documents` | featureRegistry:204, entityResolver:144 | both platforms |

iOS entry surfaces enumerated for the comparison: tabs (Summary, Projects, Discover,
Settings), Discover index (7) + All-Tools grid (45 routes), project-detail tile grid (48),
home cards (13), Summary ToolsSheet (10), CreateMenu (29), Brain FAB → Universal Search
(106 registry routes). `scripts/validate-feature-search.ts` cross-checks the registry
against the *sidebar* and route files (per `utils/featureRegistry.ts:13-16`); nothing
checks iOS parity — the guard is blind exactly where iOS is primary.

Reachable with the feature switched off: `/nearby-rfps` from `mage-id-bids/index.tsx:358`
and `featureRegistry.ts:153` while its query is `enabled: … && RFP_BROWSE_ENABLED`
(`nearby-rfps.tsx:76`) → permanent "No projects within 25 miles yet" (`:172`).
Dev-only: `/dev-seeder`, `/dev-flagship-seeder` (owner-gated at settings/index.tsx:1285).

### Method 2 — Feature flags

| flag | value | hides | surface | finished? |
|---|---|---|---|---|
| `HIRE_ENABLED` (`contexts/HireContext.tsx:32`) | false | Discover→Hire tab, `/post-job`, `/job-detail`, `/worker-detail`, `/messages`, crew→marketplace surfacing, 4 queries + realtime channel | both | no — file comment: "Post Job is a write-only dead end, listings never surface back" |
| `RFP_BROWSE_ENABLED` (`mage-id-bids/index.tsx:99`) | false | browse mode + `/nearby-rfps` query | both | yes, but see F8: the nearby fan-out push/email and `/rfp-detail` are ungated, and `/nearby-rfps` is still reachable |
| `RFP_PAID_POST_ENABLED`, `CLIENT_SUBS_ENABLED` (`ClientPaywall.tsx:82,107`) | false | paid-post + $19/$49 cards; `useClientPaywall` resolves allow | both | known founder decision |
| `SEAT_OVERAGE_BILLING_ENABLED` (`utils/seatModel.ts:63`) | false | selling a seat past the allowance → "upgrade" copy instead | both | by design until an RC seat product exists |
| `isOwner(email)` | — | Developer section + seeders | settings | dev |

### Method 3 — Data-flow graph of a job (WIRED / MANUAL / MISSING)

| edge | state | evidence |
|---|---|---|
| lead → project | WIRED | `convertLeadToProject` (`lead-detail.tsx:224`) |
| RFP response → award → project + portal | WIRED | `award_rfp` RPC (schema.sql) + `award-rfp/index.ts` |
| award → estimate / contract value | **MISSING** | `award_rfp` selects `bid_amount` and inserts only name/type/location/description/status/client_portal — F7 |
| project → estimate (wizard/full) | WIRED | `updateProject({ linkedEstimate })` |
| estimate → contract | WIRED | `buildDraftContract` uses `effectiveEstimateTotal` (`contractEngine.ts:135-143`) |
| contract milestone → invoice | WIRED | `deriveMilestoneInvoiceLine`, `markMilestoneInvoiced` (`contract.tsx:228`, `contractEngine.ts:341`) |
| estimate → schedule | WIRED | `generateScheduleFromEstimate` (5 call sites) |
| estimate rows → progress invoice | WIRED | `bill-from-estimate.tsx:104-185`, `sourceEstimateItemId` |
| approved CO → contract sum on invoice + G702 | WIRED | `invoice.tsx:176-185`; `aiaBilling.ts:135-136` |
| approved CO line items → billable rows / G703 | **MISSING** | F11 |
| approved CO → schedule (manual approve) | WIRED | preview-then-apply `change-order.tsx:583-594, 1205-1217` |
| approved CO via portal → schedule | MANUAL | reconciler flips status only (`usePortalApprovalReconciler.ts:133`); project-detail lists "place +Nd" (`:2726`) |
| approved CO → job-cost budget | WIRED | `jobCostEngine.ts:245-252` (keyed on CO description or a 'Change Orders' bucket) |
| daily report → delay event + notice clock | WIRED | `daily-report.tsx:1843-1852` → `delay-events.tsx:199-204` → `noticeClock` → `useSmartInbox` |
| daily report weather → weather delay log | **MISSING** | F14 |
| time entry → job cost (with burden) | WIRED on `/job-costing` only; rates are AsyncStorage-only; no OT premium | F5 |
| time entry → cost book (labor samples) | WIRED | `useLaborCostSamples` → `buildCostDatabase(…, laborSamples)` |
| material receipt (snapped invoice) → job cost / cost book | WIRED (job-costing, estimators); MISSING on WIP/reports/margin | `jobCostEngine.ts:268-290`; F5 |
| delivery → schedule task | **MISSING** | `Delivery` has no task ref (`deliverySchedule.ts:35-76`) — F13 |
| delivery → daily report | MANUAL | `materialsDelivered: string[]` retyped (`daily-report.tsx:162, 1784-1803`) |
| delivery receipt ↔ material receipt | **MISSING** | two unlinked objects — F13 |
| field ticket → change order | WIRED | `fieldTicketCore.ts` (T&M → CO draft) |
| invoice → payment (manual + Stripe) | WIRED | `stripe-webhook` marks paid; `payments.tsx:62-130` derives from invoices |
| payment → job cost | WIRED-by-decision (client payments as actual) | known |
| invoice paid → GC notification | **MISSING** | F19 |
| buyout award → commitment (linked to estimate items) | WIRED | `awardBidPackage` (`ProjectContext.tsx:3396-3466`) |
| commitment → sub invoice → paidToDate | WIRED (portal only) | `recompute_commitment_paid_to_date` trigger |
| sub paid outside portal → paidToDate | **MISSING** | F6 |
| commitment/paid → estimate actuals → calibration → next estimate | WIRED but starved | `estimateActuals.ts:142-151`; `estimateCalibration` needs real actuals; F6 |
| closed job → cost book → next estimate | WIRED (live derivation, no write) | `buildCostDatabase` reads `status completed/closed`; `estimate-wizard.tsx:293-306`, `full.tsx:210` `lookupRate` per row; F18 on the wizard's 6-fact slice |
| estimate rate provenance → invoice | MISSING (by design?) | `LinkedEstimateItem` has no provenance field; chip computed live via `lookupRate` — appendix |
| sub invoice paid → lien waiver | MANUAL | waiver prefill only from a *client* invoice (`invoice.tsx:1640`); nothing from sub payments |
| sub payments → 1099 | PARTIAL | portal invoices only; `tax1099Export.ts:74` `void opts.commitments` |
| prequal ↔ COI vault ↔ subcontractor.coiExpiry | **MISSING** (three unsynced sources) | F1 |
| COI expiry → reminder | broken for vault-filed COIs | F1 |
| safety incident → daily report | WIRED | `daily-report.tsx:196, 972-977` (`incident` block) |
| punch list → closeout binder (G704 punch list) | WIRED | `closeout-binder.tsx:439-459` |
| punch → warranty | **MISSING** | no reference in `warranties.tsx`, `warrantyWalks.ts` |
| closeout → project closed → cost book | WIRED | `closeout-binder.tsx:345`, `punch-list.tsx:346,389` |
| warranties/selections/subs/photos → home passport | WIRED | `utils/passport/buildHomePassport.ts` |
| Cost X-Ray → estimate line / punch item provenance | captured, never read | `xray` meta written by `cost-xray.tsx`, zero readers — F20 |

### Method 5 — Duplicate concepts

- **Estimate math** — two live conventions (F10).
- **Schedule** — one store (`project.schedule`), one front door (`ScheduleOnRamp` →
  estimate/interview/blank/template/voice/example/manual), one CPM (`utils/cpm.ts
  runCpm`, 18 call sites) — except one automation that uses a second, calendar-blind
  engine (F12). `schedule-builder.tsx` is a 10-line host for the interview; `last-planner`
  and `week-close` are views over the same tasks. This concept is in good shape.
- **Estimate surfaces** — one hub (`utils/estimateHubEntries.ts`); quick-quote and
  smart-proposal are separate documents (proposal tiers), not a second estimate store;
  the divergence is the math convention, not the model.
- **Receipts** — `DeliveryReceipt` (BOL/damage, `delivery_receipts`) vs `MaterialReceipt`
  (priced lines → cost book, `material_receipts`), unlinked (F13).
- **COI expiry** — `subcontractors.coi_expiry` (typed on Subs tab), `cois.coverages[].expiresAt`
  (vault), `prequal_packets.insurance.coiExpiry` (sub-attested) — unsynced (F1).
- **Documents** — `/documents` (derived index of contracts/waivers/pay apps, search-only)
  vs `/project-files` (storage, tile). Not a data duplicate; a navigation one.
- **Integrations** — `/integrations` (mock) vs `/qbo-setup` (real) (F2).

### Method 6 — Notifications matrix

`notify` dispatcher events (12) + digest/local kinds, with the producer that actually fires
them and whether a push tap routes anywhere (`contexts/NotificationContext.tsx:62-118`
handles kinds `portal_message`, `budget_proposal`, `co_approval`, `sub_invoice`,
`margin_alert`, `morning_brief`, `week_close`, `ask_seed`, then `conversationId|bidId|
changeOrderId`; anything else is a no-op):

| event | producer | push | email | inbox row | push tap |
|---|---|---|---|---|---|
| portal_message | DB trigger `notify_portal_message` | ✓ | ✓ | ✓ | ✓ |
| budget_proposal | trigger | ✓ | ✓ | ✓ | ✓ |
| co_approval | trigger `notify_co_approval` | ✓ | ✓ | ✓ | ✓ |
| sub_invoice_submitted | trigger | ✓ | ✓ | ✓ | ✓ |
| sub_invoice_reviewed | trigger (to sub) | — | ✓ | (sub) | — |
| nearby_rfp_posted | trigger → `notify-nearby-contractors` | ✓ | ✓ | ✓ | **dead** (kind unhandled) |
| rfp_awarded | `award-rfp` fn | ✓ | ✓ | ✓ | **dead** |
| contract_signed | portal HTML `notifyEvent` (anon-allowed) | ✓ | ✓ | ✓ | **dead** |
| selection_chosen | portal HTML | ✓ | ✓ | ✓ | **dead** |
| bid_question_asked/answered | app `bidQuestionsEngine.ts:94,155` | ✓ | ✓ | ✓ | **dead** |
| closeout_binder_sent (+GC confirmation) | app `closeout-binder.tsx:320` | ✓ | ✓ | ✓ | **dead** |
| morning_brief | `morning-digest` fn | ✓ | ✓ | ✓ | ✓ |
| portal_link_expiring/expired | fn NOT deployed, cron not applied | — | — | — | — |
| coi_expiring | `coi-expiry-watch` | — | ✓ | **no outbox row** | — |
| invoice overdue (dunning) | `invoice-dunning` → **client** | — | ✓ | — | — |
| margin_alert / week_close / ask_seed / shift alert | local notifications only | local | — | — | ✓ |

Important business events with **no producer at all**: invoice paid (GC side —
`stripe-webhook` has no notify; `:583` is a TODO for the failure case), RFI answered,
submittal returned, payment overdue (GC side), schedule slipped (in-app Brain Watch only),
lien waiver received, delivery due/unconfirmed (in-app only).

### Method 7 — Marketing vs product (top claims)

| claim (page) | verdict |
|---|---|
| "Every finished job trains your numbers… automatically" (index) | TRUE in mechanism (live derivation from closed jobs + receipts + labor); the *actuals* half is starved for GCs who pay subs outside the portal (F6); the wizard reads 6 facts, not a rate lookup (F18) |
| "It keeps score on itself" prediction ledger (index) | TRUE (`utils/brain/gradePredictions.ts`, `/track-record`) |
| Cost X-Ray prices hidden conditions on learned costs (index, pricing) | TRUE; the estimate never shows which line X-Ray produced (F20) |
| Copilot builds the schedule and shows reasoning (index) | TRUE |
| Morning brief "drafted the change order", "reflowed … around the pushed inspection" (index) | TRUE (`useLeakCoDrafts`, `inspectionResultToScheduleWork`); the reflow uses the calendar-blind engine (F12); the "60% rain" line needs a weather key the app does not have (known) |
| Chase list "Waiting on Others" incl. "Client portal link expired" (index) | screen exists but is search-only on iPhone (F4); no producer for the portal-link item (fn undeployed; `waiting-on.tsx` kinds are rfi/submittal/co_approval/delivery/quiet_trade) — appendix |
| Home passport "Ask their home anything" (index) | TRUE (`portal-ask-home` on Gemini); GC-side screen search-only on iOS (F4) |
| "QuickBooks Online 2-way sync… reconcile back… cost-review queue" (pricing) | edge fns exist; failures invisible (F3); search routes "quickbooks" to a mock (F2) |
| "Downgrade to Free and Pro features become read-only" (pricing FAQ) | FALSE (F15) |
| "Community bids · 2/mo" vs "capped at 3/mo" (pricing) | self-contradictory; code says 3 (F16) |
| Sub portal "COIs, prequal, RFIs" (pricing FAQ) | RFIs/COIs not in the sub portal snapshot (F17) |
| AI quota table (pricing Enterprise "vs 80 / 18 / 50 / 150 / 100") | matches `app/paywall.tsx:143-147` and `MONTHLY_CAPS.business` (50/150/100, ai_text 2400≈80/day) |
| "1 active project" on Free (pricing) | TRUE (`enforce_free_tier_project_cap` trigger) |
| "6 languages" portal (pricing) | TRUE (`PortalLanguage`) |

## Findings (ranked; most severe first)

### F1 — P1 CONFIRMED — COI expiry reminders can never fire for a certificate filed in the COI Vault, because the watcher reads a field the vault never writes
- Where: `supabase/functions/coi-expiry-watch/index.ts:186-195, 210-211`; `contexts/ProjectContext.tsx:4626-4640` (`addCOI`/`updateCOI`); `app/coi-vault.tsx:236` (promise), no `updateSubcontractor` anywhere in `coi-vault.tsx`; `app/(tabs)/subs/index.tsx:37-41` (compliance derived from `sub.coiExpiry`); `utils/prequalEngine.ts:148-149` (third source `insurance.coiExpiry`)
- Evidence: watcher — `.select('id,…,coi_expiry,…').not('coi_expiry','is',null).lte('coi_expiry', cutoff)`; vault write — `addCOI` does `setCois(updated); … supabaseWrite('cois','insert', coiToRow(coi))` and nothing else; vault subtitle — "we read it, flag what's missing, and remind you 30 days before it expires".
- Failure scenario: GC uploads Joe's Plumbing COI (expires 2026-10-01) in the vault; never types an expiry on the Subs tab. `subcontractors.coi_expiry` stays null → the daily cron skips the sub → no 30/14/7-day email. The Subs tab still shows the sub as compliant (it reads `sub.coiExpiry`). The building-access rule `coi_not_on_file` and the prequal engine each read their own copy. First symptom is an uninsured sub on site after the cert lapsed.
- Fix: in `addCOI`/`updateCOI`, derive `earliestExpiry = min(coverages[].expiresAt)` and call `updateSubcontractor(coi.subcontractorId, { coiExpiry: earliestExpiry, coiVerifiedAt: now })`; treat `subcontractors.coi_expiry` as the single derived field (or add an AFTER INSERT/UPDATE trigger on `cois`). Have `prequalEngine` read the same field when the packet's own value is blank.
- Effort: S

### F2 — P1 CONFIRMED — Universal Search routes "quickbooks / qbo / accounting / sync" to a mock Integrations screen whose Connect button flips local state and never connects; the real QuickBooks connect is elsewhere and unindexed
- Where: `utils/featureRegistry.ts:248`; `app/integrations.tsx:19, 96, 120-124, 187`; real path `app/(tabs)/settings/index.tsx:1121` → `/qbo-setup`; reachability: `/integrations` has no inbound reference except the registry
- Evidence: registry — `{ id: 'integrations', title: 'QuickBooks & Integrations', synonyms: ['quickbooks','qbo','accounting','bookkeeping','sync'], route: '/integrations' }`; screen — `useState<Integration[]>(MOCK_INTEGRATIONS)` and its own comment "the entire Integrations screen is preview-only (MOCK_INTEGRATIONS)… does NOT actually OAuth into any".
- Failure scenario: a Business subscriber (pricing page sells "QuickBooks Online 2-way sync") searches "quickbooks", taps the QuickBooks card, sees "Connected", and nothing ever syncs. The screen carries a PREVIEW banner, but the search result title says "QuickBooks & Integrations".
- Fix: point the registry entry at `/qbo-setup` (keep the synonyms), remove `/integrations` from the registry, and either delete `app/integrations.tsx` or gate it behind an owner flag. Add `/qbo-review` as its own entry ("QuickBooks bills to review").
- Effort: S

### F3 — P1 CONFIRMED — A QuickBooks push that fails five times is abandoned and nothing in the app shows it
- Where: `supabase/functions/qbo-reconciler/index.ts:142-164`; `contexts/ProjectContext.tsx:757` (maps `qbo_sync_status`); zero readers of `qboSyncStatus`/`qboError`/`qboRetryCount` in `app/`, `components/`, `hooks/` (dead-field scan + grep)
- Evidence: reconciler — `.or("qbo_sync_status.eq.pending,qbo_sync_status.eq.error").lt("qbo_retry_count", 5)` then on failure `qbo_sync_status: "error", qbo_error: String(…).slice(0, 500), qbo_retry_count: nextRetry`. The invoice screen greps for "qbo" return nothing; `qbo-setup.tsx:158` only says "A background job… retry anything that failed".
- Failure scenario: an invoice with a customer name QBO rejects (or an expired token between reconciler runs) errors five times, then is skipped forever. The GC's invoice list looks identical for synced and unsynced invoices; the books diverge until the accountant notices.
- Fix: read `qboSyncStatus`/`qboError` on the invoice list row and detail header ("Not in QuickBooks — {error} · Retry"), and add a "Needs attention" list to `/qbo-setup` querying `qbo_sync_status = 'error'`; a Retry sets `qbo_retry_count = 0`.
- Effort: S–M

### F4 — P1 CONFIRMED — Six shipped features (including the marketed chase list and the 09-02 Deliveries batch) have no entry point on iPhone except Universal Search
- Where: `app/(tabs)/_layout.tsx:146-154, 244-251` (`href: null` tabs); `app/(tabs)/discover/tools.tsx` (45 destinations, none of these); `app/project-detail.tsx` tile grid (48 destinations, none of these); `components/summary/ToolsSheet.tsx:33-42` (10, none of these); `components/DesktopSidebar.tsx:63, 80, 83, 90, 127, 129, 151` (web only: mounted under `layout.showSidebar`); `utils/featureRegistry.ts:13-16` (the guard checks registry↔sidebar, not iOS)
- Evidence: reachability output — `/waiting-on ← DesktopSidebar:63; featureRegistry:130`; `/deliveries ← DesktopSidebar:127; featureRegistry:229; systemOfAction:191; brainWatch:218` (the last two are per-item links that need an existing delivery); `/equipment`, `/marketplace`, `/auto-bids`, `/home-passport`, `/widget-setup` — sidebar + registry only.
- Failure scenario: an iPhone-only GC (the primary persona) reads "It knows what's about to stop the job" and "14 windows — Acme Glass — nobody confirmed it" on the homepage, then cannot find Deliveries or Waiting-on anywhere in the tab bar, Discover, or a project. The Brain Watch card will never show a late delivery because no delivery can be scheduled from the phone.
- Fix: add Deliveries (Field Ops) and Equipment rows to `discover/tools.tsx`; a Deliveries tile in the project-detail grid; "Waiting on Others" as a Summary ToolsSheet row (or a home card); Suppliers + Pre-priced Bids under Discover "Find Work"; Home Passport from the closeout binder's delivered state. Extend `validate-feature-search.ts` to fail when a sidebar route has no inbound reference from `app/(tabs)/**`, `project-detail.tsx`, `components/summary/**`, `components/home/**` or `CreateMenu.tsx`.
- Effort: S

### F5 — P2 CONFIRMED — "Projected final cost" is computed with different inputs on five screens, and the labor rates behind one of them live only on the device
- Where: `app/job-costing.tsx:118` (passes `receipts, timeEntries, laborRates`); `utils/marginRiskScore.ts:89`, `utils/financialReports.ts:92, 189`, `utils/livingEstimate.ts:252`, `utils/portalSnapshot.ts:826` (omit both); `app/wip-report.tsx:143-144` (`suggestCostToDate(commitments, receipts)` — receipts, no labor); `hooks/useLaborRates.ts:29` (`RATES_KEY = 'mageid_labor_rates'`, AsyncStorage only); `utils/jobCostEngine.ts:305` (`totalHours * rate`, `overtimeHours` unused)
- Evidence: `computeJobCost({ project, commitments, invoices, changeOrders })` at the four omitting sites vs `computeJobCost({ …, receipts, timeEntries, laborRates })` at job-costing.
- Failure scenario: a GC who snaps supplier invoices and clocks a framing crew sees "Over by $9K" on Job Costing, "green / 14% margin" on Reports → Profit and on the Margin Board, and the client portal's budget strip agrees with the wrong two. On the web app the same Job Costing screen shows a smaller number again because `mageid_labor_rates` was set on the phone. Overtime hours are costed at straight time everywhere.
- Fix: one `useJobCostInputs(projectId)` hook returning `{ commitments, invoices, changeOrders, receipts, timeEntries, laborRates }` used by every caller (portal snapshot gets the same bundle server-side or at snapshot time); persist labor rates to `profiles.labor_rates` (jsonb) with the AsyncStorage copy as cache; apply `overtimeHours × rate × 0.5` as premium.
- Effort: M

### F6 — P2 CONFIRMED — Nothing lets a GC record a payment to a sub outside the sub portal, so the actuals half of the cost-learning loop, the 1099 export and lien-waiver amounts are blind for the common case
- Where: `supabase/schema.sql` `recompute_commitment_paid_to_date` (the only writer of `commitments.paid_to_date`, fed by `sub_submitted_invoices`); no `paidToDate` writer in `app/job-costing.tsx` (commitment editor), `app/sub-portals.tsx`, or `components/RecordPaymentModal.tsx` (portal invoices only); consumers `utils/estimateActuals.ts:142-151`, `utils/estimateCalibration.ts` header ("Only lines with REAL actuals… count"), `utils/costDatabase.ts:129-133` (falls back to `committed`), `utils/tax1099Export.ts:10-12` vs `:70-74`, `app/lien-waivers.tsx:65-85` (prefill only from a client invoice via `invoice.tsx:1640`)
- Evidence: `tax1099Export.ts:10-12` says "We aggregate from sub-submitted invoices (status='paid') AND regular invoices that link to a commitment"; `:74` is `void opts.commitments; // Future: when the GC records out-of-portal payments`.
- Failure scenario: a $500K/yr remodeler pays subs by check and never onboards them to the sub portal. Every closed job's cost book entries are `basis: 'committed'`, Calibration shows "no data", Bid-vs-Actual shows 0% coverage of actuals, the 1099-NEC export reports "No payments this year" for every sub, and each lien waiver amount is retyped.
- Fix: add "Record payment" to the commitment row in `job-costing.tsx` (amount, date, method, reference) writing a `commitment_payments` ledger (or `paid_to_date` directly, with the trigger extended to sum both sources); feed `tax1099Export` from it (remove the `void`), and open `/lien-waivers?prefillCommitmentId&prefillAmount&prefillThroughDate` from the same sheet.
- Effort: M

### F7 — P2 CONFIRMED — Winning an RFP creates the project but drops the winning price, and stamps a project type the app does not know
- Where: `supabase/schema.sql` `award_rfp` (selects `v_winner.bid_amount, estimate_summary`; `INSERT INTO public.projects (id, user_id, name, type, location, square_footage, quality, description, status, client_portal)` with `type = 'awarded_rfp'`); `types/index.ts:9-22` (`ProjectType` union has no `awarded_rfp`); `utils/judges/typeMargin.ts:28`, `utils/portfolio/typeProfitability.ts:65` (type-keyed); `supabase/functions/notify/index.ts:651-652` ("We've set up the project in MAGE ID with their drawings, photos, scope, and a live portal")
- Evidence: the insert has no `estimate`, `linked_estimate`, `target_budget`, or `project_financials` write; `square_footage 0, quality 'standard'`.
- Failure scenario: the contractor opens the new project: no estimate, no contract value, Job Costing budget $0, Living Estimate empty; they re-enter their own bid by hand. Portfolio "profit by type" and the Bid Advisor's type-margin history never see awarded-RFP jobs because `'awarded_rfp'` matches no type.
- Fix: in `award_rfp`, insert a `project_financials` row (or `linked_estimate`) seeded from `bid_amount` with a single "Awarded bid" line, create a draft `project_contracts` row at `bid_amount`, and map `type` from the RFP category (default `'remodel'`). Add `'awarded_rfp'` handling to the two type engines until then.
- Effort: M

### F8 — P2 CONFIRMED — Tapping 7 of the 12 server push kinds does nothing; with browse gated off, the nearby-RFP fan-out still invites contractors to a UGC detail screen with no report/block, and `/nearby-rfps` is a permanent empty state
- Where: `contexts/NotificationContext.tsx:62-118`; `supabase/functions/notify/index.ts:617, 643, 672, 705, 736, 764, 879` (`pushData.kind` = `nearby_rfp_posted`, `rfp_awarded`, `contract_signed`, `selection_chosen`, `bid_question_asked/answered`, `closeout_binder_sent_confirmation`); `supabase/schema.sql:3693` (`public_bids_notify_nearby` trigger); `app/nearby-rfps.tsx:76, 172`; `app/(tabs)/mage-id-bids/index.tsx:358`; `utils/featureRegistry.ts:153`; `app/rfp-detail.tsx:69-81` (no gate)
- Evidence: the tap handler routes only `portal_message|budget_proposal|co_approval|sub_invoice|margin_alert|morning_brief|week_close|ask_seed`, then `conversationId|bidId|changeOrderId`; the RFP pushes send `rfpId`, the portal pushes send `projectId+portalId` with an unhandled kind — every one falls through to no-op.
- Failure scenario: (a) homeowner counter-signs the contract → GC gets "Signed and binding." on the lock screen → taps → the app opens on whatever it was last showing. (b) A homeowner posts an RFP → every contractor within range gets push + email (trigger is ungated) → push tap is dead; the email CTA lands on `/rfp-detail`, which renders the homeowner's free text and photos with no report/block — the Guideline-1.2 exposure the flag removed from browse is reachable from every fan-out. (c) The "Nearby" button and the search entry still open `/nearby-rfps`, which says "No projects within 25 miles yet" forever.
- Fix: add the missing kinds to the tap handler (`nearby_rfp_posted|bid_question_*` → `/rfp-detail?bidId=`, `rfp_awarded` → `/project-detail?id=`, `contract_signed` → `/contract?projectId=`, `selection_chosen` → `/selections?projectId=`, `closeout_binder_sent_confirmation` → `/closeout-binder?projectId=`). While `RFP_BROWSE_ENABLED` is false, gate the entry at `mage-id-bids/index.tsx:358` and the registry row, and either disable the `public_bids_notify_nearby` trigger or ship the report/block kit on `/rfp-detail` (the launch-readiness #3 fix hid two of three UGC surfaces).
- Effort: S

### F9 — P2 CONFIRMED — Two markup conventions coexist in `LinkedEstimate`, and every downstream engine must know which one wrote the row
- Where: markup-inclusive `lineTotal` — `app/(tabs)/estimate/full.tsx:594, 933, 1187, 1333`, `app/takeoff-estimate.tsx:487`; separate markup — `app/quick-quote.tsx:76-84`, `utils/proposalBuilder.ts:116-130`, `app/estimate-wizard.tsx:161, 361-373` (contingency, `markupTotal` 0); the residual patch — `utils/estimateCommit.ts:147-175`; consumers that each re-derive cost — `utils/jobCostEngine.ts:215-230`, `utils/estimateActuals.ts:44-55, 142-151`, `utils/wip.ts:162` (`baseTotal`)
- Evidence: `estimateCommit.ts` — "Snapshots authored under the OTHER convention — lineTotal PRE-markup with grandTotal = baseTotal + markupTotal, which is what utils/copilot/estimateEdit/estimateOps.ts wrote until it was realigned — are already sitting in users' revision histories".
- Failure scenario: medium-sweep #1 (budget seeded from sell), #2 (bid-vs-actual on marked-up bid), #22 (copilot re-markup), #28 (revision diff double-counts markup) were four symptoms of this one cause; the next engine that reads `lineTotal` (a new report, a portal number) repeats it.
- Fix: a single `normalizeLinkedEstimate(estimate)` applied on every write path (`updateProject` when `linkedEstimate` changes) that enforces `lineTotal = unitPrice × quantity × (1 + markup/100)`, `baseTotal = Σ unitPrice×qty`, `markupTotal = grandTotal − baseTotal`; a guard that asserts the identity over every snapshot in the dev seeders and validators.
- Effort: M

### F10 — P2 CONFIRMED — Approved change-order line items never become billable rows: Bill-from-Estimate and the G703 continuation sheet only see estimate rows
- Where: `app/bill-from-estimate.tsx:104-114` (`sources` from `linkedEstimate.items` / `estimate.materials` only); `utils/aiaBilling.ts:20-27` (`lines = invoice.lineItems.map(…)`, COs only feed `netChangeByCO`); contrast `app/invoice.tsx:176-185` (COs raise the contract base)
- Failure scenario: a $40K approved CO raises the contract sum on the invoice header and the G702 line 2, but the progress-billing screen can only bill the original rows to 100%; the GC adds a free-text "CO #3" line by hand, which then has no `sourceEstimateItemId`, lands in `(Uncategorized)` in job cost, and is not de-duplicated against the next pay app.
- Fix: extend `EstimateRowSource` with `{ kind: 'co', co, item }` for approved COs' `lineItems`, carry `sourceChangeOrderId` on `InvoiceLineItem`, and seed G703 rows from approved COs with "CO #n" prefixes.
- Effort: M

### F11 — P2 LIKELY — The failed-inspection automation reflows successors with a second, calendar-blind engine and persists the result
- Where: `utils/automation/inspectionResultToScheduleWork.ts:186` (`recalculateStartDays(unblocked)`); `utils/scheduleEngine.ts:49-99` (raw-day arithmetic, no working-day calendar or closures); the real engine `runCpm` with `cpmOptionsForSchedule(schedule)` (`utils/coScheduleReflowCore.ts:354`, 18 call sites); persisted at `app/(tabs)/construction-ai/index.tsx:465-500` (`updateProject(…)` with `work.tasks`)
- Evidence: `recalculateStartDays` — `effectiveStart = depEnd + lag` etc., nothing about `workingDays`/`closures`; every other reflow (CO, copilot edits, wizard, Pro grid) runs CPM with the schedule's calendar.
- Failure scenario: on a Mon–Fri schedule with a holiday closure, "Reflowed the schedule around the failed inspection" places successors on raw days; the next time Schedule Pro runs CPM the dates move again. The unverified link: whether the receipt the automation writes ("did for you") quotes the raw-day dates before the next CPM pass — I did not trace the receipt text.
- Fix: replace the call with `runCpm(unblocked, cpmOptionsForSchedule(schedule))` and delete `recalculateStartDays` (or make it a wrapper) so there is one engine; add the automation to `validate-schedule-date-basis`'s enumeration.
- Effort: S

### F12 — P2 CONFIRMED — A delivery is an island: no schedule task, no daily-report link, and two unlinked "receipt" objects
- Where: `utils/deliverySchedule.ts:35-76` (`Delivery` has `commitmentId`, `receiptId`, no task ref); `app/deliveries.tsx:104-138` (receiving creates a `DeliveryReceipt` only); `app/daily-report.tsx:162, 1784-1803` (`materialsDelivered: string[]`, typed by hand); `utils/materialReceipt.ts` / `hooks/useMaterialReceipts.ts` (no delivery reference); `app/scan.tsx:241-243` (a snapped invoice becomes a `MaterialReceipt`, unlinked to the delivery)
- Failure scenario: the windows land Tuesday: the PM marks the delivery received (BOL photo), retypes "14 windows — Acme" into the daily report, and separately scans the supplier invoice. The cost book learns a window price with no delivery, the delivery has no price, the schedule task "Install windows" never learns its material arrived, and the look-ahead's "late delivery stalls a crew" logic cannot name the crew.
- Fix: `Delivery.taskId?` (picker from the schedule, default = the task whose trade matches the commitment); on receive, "Snap the invoice" → `MaterialReceipt{ deliveryId }`; DFR "Materials delivered" as a picker over today's confirmed/delivered deliveries writing `deliveryIds[]` alongside the free text.
- Effort: M

### F13 — P2 CONFIRMED — The weather delay log is desktop-only; the daily report's weather and delay note never reach it, and the DFR-to-delay handoff drops the cause
- Where: only writer of `weatherDelayLog` — `app/schedule-pro.tsx:793` (WeatherRescheduleModal); reader — `app/delay-events.tsx:312`; DFR handoff — `app/daily-report.tsx:1843-1852` (params: `projectId, autoLog, firstObservedDate, description, evidence*` — no `cause`, no weather); `app/delay-events.tsx:202` (`cause` defaults to `'other'`); `components/schedule/mobile/MobileScheduleScreen.tsx:138` (mobile carries the field but never writes it); `utils/weatherReschedule.ts:270` ("the record a GC hands an owner to justify a delay")
- Failure scenario: an iPhone-only GC logs "Rain, no pour" in the DFR every wet day for a month. The delay register shows "other"-cause events with no weather attached and the weather delay log is empty, so the owner-facing justification the product describes does not exist for the primary platform.
- Fix: from the DFR button pass `cause: 'weather'` when `weather.condition ∈ {rain, snow, storm, high wind}` (with the `DFRWeather` values as `evidence`), and on save of a weather-cause delay event append a `WeatherDelayLogEntry{ source: 'daily_report', date, condition, taskIds: impactedTaskIds }` to `project.schedule.weatherDelayLog` (the log accepts observed evidence; only simulated forecasts are refused).
- Effort: S–M

### F14 — P2 CONFIRMED — The pricing FAQ promises "Downgrade to Free and Pro features become read-only on existing data"; no read-only mode exists
- Where: `marketing/pricing.html` ("Can I switch between tiers?… Pro features become read-only on existing data — nothing is deleted"); `app/job-costing.tsx:63-66`, `app/schedule-pro.tsx:144-147` (full-screen `<Paywall>` when `!canAccess`); `hooks/useTierAccess.ts` (boolean `canAccess`, no read mode); `scripts/validate-marketing-claims.ts` does not pin this sentence
- Failure scenario: a GC downgrades for the winter expecting to still read their pay apps and job-cost history; every Pro screen is a paywall. Money-adjacent promise, checked by nobody.
- Fix: either change the sentence to "Pro screens lock until you re-upgrade; nothing is deleted", or implement `canAccess(key): 'full' | 'read' | 'none'` and render gated screens read-only when the project has existing data. Add the sentence to `PRICING_BANNED` until one of the two lands.
- Effort: S (copy) / L (feature)

### F15 — P3 CONFIRMED — Pricing page contradicts itself and the code on the free bid-response cap
- Where: `marketing/pricing.html:318` ("Community bids · 2/mo") vs `:373` ("capped at 3/mo below Business"); `app/submit-bid-response.tsx:48` (`FREE_MONTHLY_BID_RESPONSES = 3`)
- Fix: change line 318 to 3/mo; pin the number in `validate-marketing-claims.ts` against the constant.
- Effort: S

### F16 — P3 CONFIRMED — Pricing FAQ sells the sub portal with "COIs, prequal, RFIs"; the sub portal has none of those sections
- Where: `marketing/pricing.html` ("They get the sub portal — daily progress, schedule, photos, COIs, prequal, RFIs"); `utils/subPortalSnapshot.ts:5-45` (`submittedInvoices`, `punchItems`, `scheduleSlice`); no `rfi`/`coi` in `subPortalSnapshot.ts` or `marketing/sub-portal/index.html` (prequal is a separate magic-link form, not the portal)
- Fix: "daily progress, schedule, punch items, photos, invoices, and a prequal form".
- Effort: S

### F17 — P2 CONFIRMED — Money and schedule events that matter most to a GC produce no notification at all, and COI warnings never reach the in-app inbox
- Where: `supabase/functions/stripe-webhook/index.ts` (no notify call; `:583` "TODO: notify the contractor that a client tried but failed"); `supabase/functions/coi-expiry-watch/index.ts` (Resend only — no `notification_outbox` write, so no push and no row in `/notifications-inbox`); no producer anywhere for RFI answered / submittal returned / lien waiver received / schedule slip; `invoice-dunning` emails the client, never the GC
- Failure scenario: a client pays a $28K invoice through the Stripe link at 9 pm; the GC learns it the next time they open Payments. An architect answers an RFI in the portal; the superintendent waiting on it is not told.
- Fix: `stripe-webhook` → `notify` event `invoice_paid` (GC push + outbox); `coi-expiry-watch` → write an outbox row (`coi_expiring`, push if token); app-side `notifyEvent('rfi_answered' | 'submittal_reviewed')` from the RFI/submittal update paths (new dispatcher cases, ~40 lines each).
- Effort: M

### F18 — P2 CONFIRMED — The estimate wizard grounds the AI on the six largest-exposure cost-book entries regardless of the scope being priced
- Where: `app/estimate-wizard.tsx:303` (`costDb.entries.slice(0, 6)`); `utils/costDatabase.ts:297` (`entries.sort((a,b) => b.totalActual - a.totalActual)`); contrast `app/(tabs)/estimate/full.tsx:210` (`lookupRate` per row) and `utils/aiService.ts:726-728` (CO grounding filters entries by the line's trade)
- Failure scenario: a GC whose book has 30 trades asks the wizard for a bathroom; the prompt carries roofing, concrete, framing, siding, windows and HVAC (their biggest jobs) and nothing about tile, plumbing or fixtures. The "gets smarter every job" promise is real on the Full Estimator and mostly decorative on the hero Quick Estimate.
- Fix: select entries by relevance to the wizard's answers (project type → trade list, plus assemblies' categories), fall back to top-N only when nothing matches; pass `suggestedRate` + provenance for each matched trade.
- Effort: S–M

### F19 — P3 CONFIRMED — Captured-but-never-read fields (hand-verified subset of `out/dead_fields.txt`)
- `LinkedEstimateItem.xray`, `PunchItem.xray` — written by `app/cost-xray.tsx` (2 sites) and `project-detail.tsx:1035`; zero readers. The homepage's "◎ Cost X-Ray caught what the walk-through didn't" never renders on the estimate line or punch item.
- `Invoice.qboSyncStatus / qboError / qboRetryCount / qboHash / qboSyncedAt` — mapped at `ProjectContext.tsx:757`, never displayed (F3).
- `ProjectSchedule.weatherAlerts` — read by `hooks/useSmartInbox.ts:303`, never persisted (the tab keeps alerts in `useState`, `schedule/index.tsx:225`) — a dead inbox branch.
- `ProjectSchedule.bufferDays` — wizard writes 0 (`schedule-wizard.tsx:548`), engine defaults 3 (`scheduleEngine.ts:409`), no reader.
- `ProjectPhoto.locationAccuracyMeters` — 4 writers, 0 readers.
- `DelayEvent.sealedAt / contentHash` — mapped (`ProjectContext.tsx:1012`), no seal UI or badge in `delay-events.tsx`.
- `ClientPortalSettings.linkGeneratedAt` — written `client-portal-setup.tsx:599`, never read (`portalLinkExpiry.ts` takes `expiresAt`).
- `SubSubmittedInvoice.notesFromSub / submittedByEmail` — mapped from columns the portal never fills (`sub_portal_submit_invoice` has no notes param).
- `ScheduleTask.isAutoGenerated` — written by automation, read only in comments.
- Declared, never written or read: `Project.parcelId`, `ProjectSchedule.fragnets`, `DailyFieldReport.safetyToolboxTalk`, `WorkOrder.linkedLeadId`.
- Not dead (heuristic false positives, verified): `Project.noticePeriodAssumed` (read via `?.` in `noticeClock.ts:144`).
- Fix: delete the four declared-only fields; render `xray` provenance (one chip); persist or drop `weatherAlerts`; the rest are S each.
- Effort: S

## ADD / CONNECT / DO BETTER (ranked by leverage)

The ten highest-leverage CONNECT moves for a small GC. Producer → consumer locations are
exact; sizes assume the codebase's existing patterns (offline queue, pure engines + validator).

### O1 — Record a sub payment on a commitment (the missing write behind the moat) — leverage: turns on calibration, real-basis cost-book samples, 1099 and lien-waiver prefill for every GC who pays subs by check — evidence: F6 — sketch: producer `app/job-costing.tsx` commitment row → "Record payment" sheet (reuse `components/RecordPaymentModal.tsx` shape) → `supabaseWrite('commitment_payments','insert')` + `paid_to_date` rollup (extend `recompute_commitment_paid_to_date` to sum both); consumers `utils/estimateActuals.ts:142-151` (unchanged), `utils/estimateCalibration.ts` (now has actuals), `utils/tax1099Export.ts:74` (replace `void opts.commitments`), `app/lien-waivers.tsx:83` (accept `prefillCommitmentId`). Size: M (1 table, 1 trigger edit, 1 sheet, 2 consumer edits, validator).

### O2 — One job-cost input bundle — leverage: the same "projected final" on Job Costing, Reports/WIP/Profit, Margin Board, Living Estimate and the client portal — evidence: F5 — sketch: `hooks/useJobCostInputs.ts` (receipts via `useMaterialReceipts`, time entries via `useTimeEntriesMirror`, rates via `useLaborRates`) → callers `job-costing.tsx:118`, `utils/financialReports.ts:92,189` (pass through from `app/reports.tsx`), `utils/marginRiskScore.ts:89`, `utils/livingEstimate.ts:252`, `utils/portalSnapshot.ts:826`; move rates to `profiles.labor_rates`. Size: M.

### O3 — COI vault → subcontractor expiry → watcher/compliance/building access — leverage: the one compliance reminder the product promises actually fires — evidence: F1 — sketch: `contexts/ProjectContext.tsx:4626` `addCOI/updateCOI` → `updateSubcontractor({ coiExpiry, coiVerifiedAt })`; `utils/prequalEngine.ts:148` reads the sub's field when the packet is blank; consumer `coi-expiry-watch/index.ts:186` unchanged. Size: S.

### O4 — iOS parity for the sidebar — leverage: Deliveries, Waiting-on, Equipment, Suppliers, Pre-priced Bids and Home Passport become reachable on the primary platform — evidence: F4 — sketch: rows in `app/(tabs)/discover/tools.tsx`, a `Deliveries` tile in `app/project-detail.tsx` grid (next to Field Ticket, ~1884), a Summary ToolsSheet row for `/waiting-on`, a "Home Passport" CTA in `closeout-binder.tsx` after delivery; guard extension in `scripts/validate-feature-search.ts`. Size: S.

### O5 — CO line items → progress billing + G703 — leverage: a job with COs can be billed to 100% inside the flow; CO scope stops landing in `(Uncategorized)` — evidence: F10 — sketch: producer `app/change-order.tsx` (approved `lineItems`) → `app/bill-from-estimate.tsx:104` sources (`kind:'co'`) → `InvoiceLineItem.sourceChangeOrderId` → `utils/aiaBilling.ts:23` rows; `utils/jobCostEngine.ts:245` can then attribute CO actuals by line. Size: M.

### O6 — Award → estimate/contract seed — leverage: the RFP marketplace's "You won" lands on a project with a budget and a contract draft, not a blank — evidence: F7 — sketch: `award_rfp` inserts `project_financials` (one line at `bid_amount`, category from RFP) and a draft `project_contracts` row; same for `convertLeadToProject` (`contexts/ProjectContext.tsx`) when the lead has a budget → seed `targetBudget`/draft estimate. Size: M (SQL + one mapper).

### O7 — Delivery ↔ task ↔ receipt ↔ DFR — leverage: one delivery record feeds the schedule, the daily report and the cost book instead of three retypes — evidence: F12 — sketch: `utils/deliverySchedule.ts` `Delivery.taskId?`; `app/deliveries.tsx:104` receive → optional `MaterialReceipt{ deliveryId }` via `hooks/useMaterialReceipts.addReceipt`; `app/daily-report.tsx:1784` picker over `deliveries` writing `deliveryIds`; `utils/brainWatch.ts:214` can then say which task the late load stalls. Size: M.

### O8 — DFR weather/issues → weather delay log + weather-cause delay event (mobile) — leverage: the owner-facing delay record exists for phone-first GCs — evidence: F13 — sketch: `app/daily-report.tsx:1843` params `+cause, +weather`; `app/delay-events.tsx:202` honours `cause`; on save, append to `project.schedule.weatherDelayLog` (`ProjectContext.updateProject`) with `source:'daily_report'`; `utils/noticeClock.ts` unchanged. Size: S–M.

### O9 — Cost book read side: scope-relevant grounding + persisted provenance — leverage: the moat's read half matches its write half; "stated vs measured" survives into snapshots, PDFs and Bid-vs-Actual — evidence: F18, appendix note on provenance — sketch: `app/estimate-wizard.tsx:303` select entries by trade match (reuse the filter at `utils/aiService.ts:726`); on estimate write, stamp `LinkedEstimateItem.rateProvenance?: 'earned'|'seeded'|'mixed'|'none'` from `lookupRate`, so `utils/brain/estimateSnapshot.ts`, `utils/estimateActuals.ts` and (internally) `InvoiceLineItem` can carry it. Size: M.

### O10 — Notifications for money events + push-tap routes — leverage: the GC hears about the payment, the answered RFI and the expiring COI where they already look — evidence: F8, F17 — sketch: `stripe-webhook/index.ts` → `notify` `invoice_paid`; `coi-expiry-watch/index.ts` → outbox insert; app `notifyEvent('rfi_answered')` from `updateRFI` when status flips to answered; `contexts/NotificationContext.tsx:62` add the seven missing kinds. Size: M.

Also worth doing, smaller: punch item (trade, location) → warranty claim prefill from `app/warranties.tsx` (today: no link); QBO error surfacing (F3, S); registry → `/qbo-setup` (F2, S).

## Appendix — lower-severity notes (one line each with file:line)

- `/nearby-rfps` empty-state copy says "No projects within N miles yet" while the query is disabled — `app/nearby-rfps.tsx:76,172` (part of F8).
- Approved-via-portal COs need a manual "place +Nd" step; fine, but the list lives only inside the project's Change Orders tile — `app/project-detail.tsx:2726-2737`; nothing in Brain Watch/Waiting-on chases it.
- Rate provenance is computed live (`lookupRate` at render) and never persisted on the estimate item, so a seed that later earns a job retroactively relabels old estimates and PDFs/snapshots cannot reproduce the chip — `components/estimate/RateProvenanceChip.tsx:96-104`, `types/index.ts:1170-1205`.
- Overtime hours are computed (`hooks/useTimeEntries.ts:111-118`) and never costed at a premium — `utils/jobCostEngine.ts:305`.
- Labor-burden model is nudge-only by design; no per-GC burden % is ever stored, so "loaded" is an honor system — `utils/laborBurdenModel.ts:8-15`.
- Homepage chase-list example includes "Client portal link expired"; no in-app producer exists (`app/waiting-on.tsx:31-37` kinds; `portal-link-expiry-notice` undeployed, cron not applied) — labelled "Example board", so a soft claim.
- Web sidebar shows a lock badge on "Schedule" for Free (`components/DesktopSidebar.tsx:100` `requires: 'schedule_gantt_pdf'`) while the tab itself is free and only Schedule Pro is gated (`app/(tabs)/schedule/index.tsx:203-208`); pricing says Free includes "Basic schedule (manual Gantt)".
- `/documents` is a derived index reachable only via search/entity nav; `/project-files` is the tile — two "documents" concepts for the user — `utils/featureRegistry.ts:204`, `app/project-detail.tsx:1885`.
- `/material-receipt` (snap a supplier invoice — a cost-book feeder) is reachable only from Job Costing (Pro) — `app/job-costing.tsx:306`; Scan Anything (Business) also creates receipts — `app/scan.tsx:241`.
- `useSmartInbox.ts:303` reads `schedule.weatherAlerts`, which nothing persists (F19).
- `HireContext` comment records that Post Job is a write-only dead end — `contexts/HireContext.tsx:26-32`; consistent with the flag, nothing further to do for 1.0.
- `awarded_rfp` reaches `ProjectRow` safely (`components/ProjectRow.tsx:63` has a `?? Building2` fallback) — the type problem is analytical (F7), not a crash.

## What I could not verify (and how it could be)

- Whether the automation "did for you" receipt quotes raw-day dates before the next CPM pass (F11's one unverified link) — read `utils/brain/didForYou*` and the receipt text in `app/(tabs)/construction-ai/index.tsx:465-520`, or run the failed-inspection flow on the simulator with a schedule that has a closure.
- Whether any deployed edge function differs from the repo for the paths cited (notify, stripe-webhook, coi-expiry-watch, qbo-reconciler); START-HERE says 14 functions are behind the repo. `supabase functions download` from a scratchpad directory would settle it; not run (network/auth).
- Whether `profiles.push_token` is populated for real users (push-tap findings assume push delivery); a SELECT count on `profiles where push_token is not null` would tell — not run because nothing in this domain depended on it.
- The user-visible date disagreement in F11 on a real calendar; needs a simulator run.
- Marketing "learned cost catalog" tier badge vs `job_costing='pro'` is pinned by the guard; the sub-portal and read-only sentences are not — verified by reading the guard, not by running it.
