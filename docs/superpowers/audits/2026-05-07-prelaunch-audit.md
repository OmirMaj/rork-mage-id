# MAGE ID — Pre-Launch Workflow Audit (Living Doc)

**Date started:** 2026-05-07
**Status:** in progress
**Plan:** docs/superpowers/plans/2026-05-07-prelaunch-workflow-audit.md
**Spec:** docs/superpowers/specs/2026-05-07-prelaunch-workflow-audit-design.md

**Finding ID counter:** next is AUD-001

---

## 1. Charter

See spec §1 for full text. Summary:
- Pre-launch lock-in audit; output is a ranked punch list.
- Three pillars: golden paths, A1–A10 assertion rubric, 30-item competitor checklist.
- Headless-first execution: Claude reads code, user verifies hardware-only items.
- Severity rubric and per-finding schema defined in spec §3, §4.

## 2. Golden-path runs

### 2.1 Path 1 — Homeowner kitchen remodel (residential)

_Walked in Task 3. Step results listed below; failed assertions point to §5 punch list._

| Step | Result | Notes |
|---|---|---|
| 1. Qualify lead | **PASS** | `convertLeadToProject` (ProjectContext.tsx:1558-1601) carries name, type, address, scope, budget, primary contact across. Strong A1. |
| 2. Takeoff → estimate | **FAIL A1** → AUD-002 | `drawing-analyzer.tsx:150-153` explicit comment: AI output not 1:1 with EstimateBreakdown shape; navigates to /estimate without hydration. `takeoff-estimate.tsx` is a separate AI-priced flow that does work; verify which path users hit by default. |
| 3. Build estimate | **FAIL A10** → AUD-005 | `EstimateBreakdown` interface (types/index.ts:58-74) has no version / revision / history fields. Editing overwrites prior. |
| 4. Material buyout | **PASS** | `buyout.tsx` references `estimateBudget` and "estimate line items so the budget rolls up automatically" — quantities flow. |
| 5. Homeowner reviews estimate | **PASS** A1 | `client-view.tsx:410` reads `project?.estimate?.grandTotal`. Verify line-item parity in Phase 2. |
| 6. Sign contract | **PASS** A1 | `contract.tsx` checks project.status `draft`/`estimated` and contract derives via project.estimate. ProjectContract has `version: number` (types/index.ts:234). Strong A8. |
| 7. Project init + permits | **FAIL A1, A4** → AUD-003, AUD-004 | `schedule-wizard.tsx:82-90` seeds from generic templates (`template.tasks`), NOT from estimate line items. `permits.tsx` has rich PermitStatus enum but no schedule-task gating logic — permit denial does not block dependent schedule activities. |
| 8. Selections (#1 residential pain) | **PARTIAL** | **Strong**: overage → CO handoff (`selections.tsx:138-153`) is correctly wired with router prefill — better than competitors. **Gap**: in-app `client-view.tsx` shows no selection UI; homeowner picks must happen via `marketing/portal/` web. Verify Phase 2 the web portal flow works end-to-end. Within-allowance picks don't post to budget dashboard (acceptable by design — allowance was already in estimate). |
| 9. Pre-con docs | **PASS** | `project-files.tsx` mounts `<ProjectFilesBrowser>` component cleanly; portal-scope filter inside that component (Phase 2 verify). |
| 10. Daily ops + photos | **PASS A1, A7** (predicted) | `addDailyReport`, `addProjectPhoto`, `updateProjectPhoto` in ProjectContext all route through `supabaseWrite` (offline queue). Photos store via `tertiary_photos` key with Supabase mirror. A6 + A7 hardware verification pending. |
| 11. Weekly digest | **PASS** | `homeowner-weekly-digest` edge fn is well-structured: pg_cron Friday-16:00-UTC fan-out, Gemini-rewritten with deterministic template fallback, RESEND_API_KEY for delivery, scoped to `clientPortal.weeklyDigest.enabled` projects. |
| 12. Stone-upgrade CO from message | **FAIL A1, A2-budget** → AUD-006, AUD-007 | `client-messages.tsx` is a plain chat surface; no "convert message to CO" affordance (compare to selections.tsx:138-153 which does have prefill router push — pattern exists, just not extended). CO `scheduleImpactDays` IS applied to schedule (project-detail.tsx:1866-1874 — A2-schedule PASS). CO `changeAmount` does NOT propagate to `project.targetBudget` — A2-budget partial fail; revised contract surfaces only via linkedEstimate / pay app aggregates. |
| 13. Progress invoice + Stripe | **PASS A1** (predicted A2-cashflow) | `bill-from-estimate.tsx:54-83` builds source rows from `LinkedEstimateItem` first, falls back to `MaterialLineItem`. Invoices draw down against the contract correctly. `markAsPaid` (`invoice.tsx:572-580`) creates `InvoicePayment` and updates status. A2-cashflow predicted PASS via getInvoicesForProject aggregation. A7 hardware pending. |
| 14. Punch | **FAIL A4** → AUD-009 | Punch items are pulled into the closeout binder but open items do not block status='delivered'. The binder allows distribution with `openPunch.length > 0`. |
| 15. Warranty + handover + closeout | **FAIL A1** → AUD-008 | `closeout-binder.tsx:58` destructures from useProjects: `commitments, warranties, projectPhotos, rfis, submittals` — **lien waivers missing**. The binder does not auto-include `LienWaiver` records, even though `lien-waivers.tsx` exists with full CRUD. Selections, warranties, photos all flow correctly. |

**Path 1 cross-cutting findings:** AUD-010 / AUD-011 / AUD-012 (offline-queue bypasses in 3 marketplace screens — touch Path 1 only via the lead-source case but more relevant in Path 2).

### 2.2 Path 2 — Commercial tenant fit-out

_Walked in Tasks 4 + 5. Step results listed below._

| Step | Result | Notes |
|---|---|---|
| 1. RFP intake | **PASS** | `rfp-detail.tsx` queries `bid_responses` table cleanly. Spec-book parsing via `extract-submittals.tsx` + `analyze-spec-book` edge fn (quality verification is Phase 2). |
| 2. Bid response | **FAIL A7** → AUD-011 (filed in Path 1) | `submit-bid-response.tsx:94` direct insert bypasses offline queue. |
| 3. Award | **PASS** | `award-rfp` edge fn is well-architected: atomic via service-role key, JWT-verified caller ownership of `public_bid`, sets bid_response.status='awarded', closes bid, creates project in awarded contractor's account, sets up clientPortal. Loser bidders updated via standard RLS. |
| 4. Prequal + COI | **PASS** (strong) | `PrequalPacket` (types/index.ts:1639-1670) keys on `subcontractorId` not `gcId` — packets are stored per-sub, federated. `projectId` is optional ("set when packet is gated to a specific project's criteria"). Magic-link invite via `inviteToken` (no auth needed). `coi-expiry-watch` edge fn: daily cron, 30/14/7-day thresholds + day-after-overdue, dedup via `coi_last_warned_at` + `coi_last_warned_threshold` so 30-day warning fires once not daily. Better than competitors. |
| 5. AIA contract | **PASS** | Same `contract.tsx` covered in Path 1 step 6. ProjectContract has `version: number`. |
| 6. SOV creation | **FAIL A1, A2** → AUD-013 | The "single SOV" the spec called for does NOT exist as a stable system-of-record. Chain is: ProjectContract.lineItems → LinkedEstimateItem (bill-from-estimate working state) → InvoiceLineItem → AIASOVLine (seeded from invoice via `seedAIAPayApplicationFromInvoice`). Four distinct line-item structures, no shared ID. CO cascade depends on each hop re-seeding correctly. Pay-app carry-forward keys on `itemNo` (lines 119-130) — strong fix for the most-complained-about Procore behavior, but doesn't address the upstream chain fragility. |
| 7. Project init + Gantt | **PASS** (strong) | `schedule-pro.tsx:58, 183, 204` uses `runCpm` from `utils/cpm` — real critical-path computation, near-critical-float threshold for "yellow" tasks, composite `ScheduleHealthScore`. Fragnets and baselines tracked (types/index.ts ScheduleBaseline, ScheduleFragnet). Better than most competitor offerings. |
| 8. Long-lead submittals | **PASS** A4 (predicted; verify Phase 2 status-blocks-task) | `submittal.tsx:197-198` reads `project?.schedule?.tasks` and exposes `linkedTaskId` so a submittal can target a specific schedule activity. The link is bidirectional in the data model. Whether status changes (e.g. "Revise & Resubmit") visibly gate or warn on the dependent task is verified in Phase 2 — the linkage exists; the UI treatment may or may not be active. |
| 9. Buyout + sub onboarding | **PASS** A3 (verify Phase 2 web portal) | `SubPortalLink` (types/index.ts:1985-2002) has `commitmentIds?: string[]` to scope the portal — "If empty the portal shows all commitments tied to this sub on this project." Sub experience runs at `marketing/sub-portal/` (web) gated by `portalId` token + RLS. The in-app `sub-portals.tsx` list is GC-side. Cross-sub leakage check is Phase 2 hardware. |

### 2.3 Path 3 — Internal GC operations

_Walked in Task 6. Requires Paths 1 + 2 to be at least partially analyzed first so portfolio-level expectations make sense._

(empty — populated by Task 6)

## 3. Domain-object lifecycle index

Built from `types/index.ts`, AsyncStorage keys in `contexts/ProjectContext.tsx:12-42`, and the canonical write path `utils/offlineQueue.ts::supabaseWrite`.

**Conventions:**
- `Created in` — screen or edge function that instantiates a new instance.
- `Edited in` — other screens that mutate. (Not exhaustive; primary edit surfaces only.)
- `Derived from` — upstream artifact that seeds initial values.
- `Flows to` — downstream artifacts that reference or consume.
- `Storage` — AsyncStorage key + Supabase table (when present). `buildwise_*` is legacy core; `tertiary_*` is the newer per-project sub-collection prefix.
- All money-bearing artifacts SHOULD route writes through `supabaseWrite` for offline queue support.

| Object | Created in | Edited in | Derived from | Flows to | Storage | Notes |
|---|---|---|---|---|---|---|
| Lead | `leads`, `lead-detail` | `lead-detail` | (manual / marketplace) | Estimate, Project | `tertiary_leads` + Supabase `leads` | A1 critical: lead → estimate handoff (Path 1 step 1) |
| Project | `project-detail` (init flow) | `project-detail` | Lead, ProjectContract | DailyReport, Schedule, Photo, Invoice, ChangeOrder, RFI, Submittal, etc. | `buildwise_projects` + Supabase `projects` | Root container. Legacy key. |
| EstimateBreakdown | `estimate-wizard`, `takeoff-estimate` | `estimate-wizard` | TakeoffResult, MaterialLineItem, LaborLineItem | ProjectContract (line items), Invoice, BillFromEstimate, BidPackage | Stored in Project (no top-level key) | A1: takeoff → estimate; A10: revisions tracked? |
| TakeoffResult | `takeoff`, `drawing-analyzer`, `takeoff-estimate` | `takeoff` | Drawing/photo upload via `analyze-takeoff` fn | EstimateBreakdown, Buyout | (in-memory / project) | Edge-fn-derived; verify provenance carries |
| ProjectContract | `contract` | `contract` | EstimateBreakdown, ContractAllowance, PaymentMilestone | LinkedEstimate, Invoice, ChangeOrder, AIAPayApp SOV | Inside Project (`contract`) | A1 keystone: estimate → contract → SOV |
| LinkedEstimate / LinkedEstimateItem | `bill-from-estimate` | `bill-from-estimate` | ProjectContract line items | Invoice line items | Inside Project | A1: ensures invoice line items pull from contract not raw estimate |
| ChangeOrder | `change-order` | `change-order` | ProjectContract line items, RFI (handoff) | Invoice, AIAPayApp, ProjectSchedule | `tertiary_change_orders` + Supabase `change_orders` | A2: must update SOV + schedule. A10: additive on edit, prior CO math preserved |
| RFI | `rfi` | `rfi` | (manual or schedule task block) | ChangeOrder (via `RFIHandoff`), Submittal | `tertiary_rfis` + Supabase `rfis` | A4: 5-day SLA + schedule annotation; `RFIBallInCourt` field present (good); RFIHandoff struct exists for CO link |
| Submittal | `submittal`, `extract-submittals` | `submittal` | Spec book (via `analyze-spec-book` fn) | ProjectSchedule (long-lead gating) | `tertiary_submittals` + Supabase `submittals` | A4: 6 statuses present in `SubmittalStatus`; verify schedule blocking |
| ScheduleTask / ProjectSchedule | `schedule-wizard`, `schedule-pro` | `schedule-pro` | EstimateBreakdown, ProjectContract SOV | DailyReport (against tasks), CO (impacts), Submittal (gates) | Inside Project (`schedule`) | A4 hub: many objects gate or update schedule. ScheduleAuditEntry exists (A8 good for schedule) |
| Permit | `permits` | `permits` | (manual application) | ProjectSchedule (gates) | `tertiary_permits` + Supabase `permits` | A4: permit status should gate dependent activities |
| SelectionCategory + SelectionOption | `selections` | `selections` | EstimateBreakdown allowance lines | Invoice, Budget, Client portal | Inside Project (`selections`) | A2 critical (#1 residential pain): pick must update budget + portal + invoice |
| DailyFieldReport | `daily-report` | `daily-report` | ProjectSchedule (which tasks active), TimeEntry | Photo, Client digest, Invoice (T&M), Job costing | `tertiary_daily_reports` + Supabase `daily_reports` | A1, A7 hot: Path 1 step 10 + Path 2 step 12. Has DFRWeather, IncidentReport, ManpowerEntry — rich |
| ProjectPhoto | `photo-annotator`, `photo-triage`, `daily-report` | `photo-annotator` | (camera / upload) | DailyReport, Client digest, PunchItem (via DrawingPin), Closeout binder | `tertiary_photos` + Supabase `photos` | A5: auto-tagging behavior (room/phase) should be verified |
| TimeEntry | `time-tracking` | `time-tracking` | (manual clock-in) | DFR ManpowerEntry, JobCosting, Payroll/1099 | (verify in `app/time-tracking.tsx`) | A1, A7 (Path 3 step 7): must flow to job costing without re-entry |
| Invoice + InvoicePayment + RetentionRelease | `invoice`, `bill-from-estimate` | `invoice` | ProjectContract, EstimateBreakdown, ChangeOrder, AIAPayApp G703 | Payment, BudgetDashboard, CashFlow | `tertiary_invoices` + Supabase `invoices` | A2: paid status → cashflow. A8: InvoicePayment array tracks history |
| SavedAIAPayApp + SavedAIAPayAppLine | `aia-pay-app` | `aia-pay-app` | ProjectContract SOV, ScheduleTask % complete, ChangeOrder, LienWaiver | Payment, CashFlow, ClosoutBinder | `tertiary_aia_pay_apps` + Supabase | A2 keystone: SOV → schedule → pay app. Lien waiver gate verified at step 15 |
| Payment | (auto from `stripe-webhook` fn / `invoice` payments[]) | (system) | Invoice, AIAPayApp | CashFlow, BudgetDashboard, JobCosting | Inside Invoice.payments | A1: webhook → invoice update; A8: PaymentStatus tracked |
| LienWaiver | `lien-waivers` | `lien-waivers` | Sub + AIAPayApp period | AIAPayApp gate, ClosoutBinder | (verify; not in keys list — likely inside SubPortalLink or Subcontractor) | **Storage gap:** no top-level `tertiary_lien_waivers` key found; check where stored |
| PunchItem | `punch-walk`, `ai-punch`, `punch-list` | `punch-list` | DrawingPin, photo, manual entry | ClosoutBinder, Warranty link | `tertiary_punch_items` + Supabase `punch_items` | A4: open items should block closeout |
| Warranty + WarrantyClaim | `warranty-walk`, `warranties` | `warranties` | ClosoutBinder, manufacturer manual | ClosoutBinder | `tertiary_warranties` + Supabase `warranties` | A1: handover binder must include all warranties |
| OACMeeting + OACAgendaItem + OACActionItem | `oac-meeting` | `oac-meeting` | RFI log, Submittal log, ChangeOrder log, ScheduleTask | Action item routing, distribution log | `tertiary_oac_meetings` + Supabase `oac_meetings` | A1: agenda must auto-aggregate from related logs. **Note: stale comment at ProjectContext.tsx:663-665 says "local-only" but code below it actually mirrors to Supabase** — comment should be deleted (cosmetic) |
| CertificateOfInsurance + COIValidationResult | `coi-vault` | `coi-vault` | Sub upload, `coi-expiry-watch` fn | Project gate, AIAPayApp gate (potentially) | `tertiary_cois` + Supabase `cois` | A4/A5: expiry watch is via edge fn cron; verify 30-day pre-expiry email |
| PrequalPacket | `prequal-form`, `prequal-manager` | `prequal-manager` | Sub data | Sub onboarding gate | `tertiary_prequal_packets` + Supabase | A1: federated profile question — is packet at GC level or global sub level? |
| Subcontractor | (admin / `sub-portal-setup`) | `sub-portals`, `prequal-manager` | (manual) | PrequalPacket, COI, AIAPayApp (sub-by-sub waivers) | `tertiary_subcontractors` + Supabase `subcontractors` | A1, A3: scope of access controlled by `SubPortalLink` |
| Equipment + EquipmentUtilizationEntry | `equipment`, `equipment-detail` | `equipment-detail` | (manual / marketplace) | JobCosting (utilization) | `tertiary_equipment` + Supabase `equipment` | A1: equipment time → cost code |
| BidPackage + BidPackageBid + Commitment | `buyout`, `buyout-package` | `buyout` | EstimateBreakdown, Sub bid responses | Subcontractor.activeContracts, Schedule, JobCosting | `tertiary_bid_packages`, `tertiary_bid_package_bids`, `tertiary_commitments` + Supabase | A1: estimate quantities → buyout |
| Commitment | `buyout` | (admin) | BidPackageBid award | AIAPayApp (sub commitments), JobCosting | `tertiary_commitments` + Supabase | A2: commitments roll up to portfolio buyout pipeline |
| PublicBid + HomeownerBidResponse | `nearby-rfps`, `my-rfps`, `post-rfp`, `rfp-detail` | `submit-bid-response`, `rfp-responses-review` | (marketplace) | EstimateBreakdown, ProjectContract on award | (verify in `BidsContext.tsx`) | A1: RFP → bid → award → contract handoff |
| ContactRole / Contact | `contacts` | `contacts` | (manual) | RFI, Submittal, OACMeeting attendees, distribution lists | `tertiary_contacts` + Supabase `contacts` | A5: contacts feed notification routing |
| ProjectDocument | `documents`, `project-files` | `documents` | (upload) | (referenced by Permit, ContractSignature, COI, etc.) | (in Project.documents) | A8: signed/expired status tracked via `DocumentStatus` |
| PortalMessage | `client-messages`, sub portal | `client-messages` | (manual / system events) | ChangeOrder (when message converts to CO) | `tertiary_portal_messages` + Supabase `portal_messages` | A1: message → CO conversion (Path 1 step 12) |
| ClientPortalSettings + SubPortalLink | `client-portal-setup`, `sub-portal-setup` | (admin) | (manual) | Portal data filters (A3 enforcement) | Inside Project / `tertiary_sub_portal_links` | A3 keystone: settings define what each persona sees |

**Domain-trace findings filed:** AUD-001 (offline queue silent failure on non-network Supabase errors). See §5.

## 4. Competitor table-stakes

_Walked in Task 7. 30-item checklist from spec §7 with green/yellow/red status against MAGE ID._

(empty — populated by Task 7)

## 5. Punch list

_All findings, all sources. Use the finding template defined in the plan. Sort by AUD-### ascending._

**Finding ID counter:** next is AUD-014.

### AUD-001 — Offline queue silently drops non-network Supabase errors
- **severity:** should
- **source:** domain-trace
- **step:** (n/a)
- **assertions:** A8 (audit trail — user has no signal); A1 (continuity from user's perspective — they think it saved)
- **personas:** all (every persona that writes data through `supabaseWrite`)
- **expected:** When `supabase.from(...).insert/update/delete` fails for ANY reason, the user gets a clear UI signal that the write didn't land (toast, banner, or persistent badge). Failed writes are either retried, surfaced in the offline queue, or flagged for manual resolution.
- **actual:** `utils/offlineQueue.ts::supabaseWrite` (line 142–158) only enqueues writes that fail with a recognizable network error (TypeError or message matching "Network request failed"/"Failed to fetch"/"network"). Any other Supabase error — RLS denial, validation, server 500, schema mismatch, transient timeout that doesn't match the network heuristic — is logged via `console.log` (line 154) and the function returns `false`. Whether the user sees the failure depends entirely on each call site's handling of the boolean return; a screen that fires a "Saved!" toast unconditionally would silently lose data.
- **repro:** 1. Force a non-network Supabase error (e.g. submit a write that violates an RLS policy, or have the server return 500). 2. Observe the screen behavior. 3. Check whether the failure is surfaced to the user.
- **screens / files:** `utils/offlineQueue.ts:115-159`; every screen that calls `supabaseWrite` (use `rg "supabaseWrite\(" app/ contexts/`).
- **scope:** M (need to either retry transient errors with backoff, surface non-retryable errors in a UI inbox, or audit each call site for proper false-return handling)
- **delivery:** OTA (utility-level change)
- **xref:** (none yet — not in `docs/workflow-audit-roadmap.md`)
- **status:** confirmed-headless

### AUD-002 — AI takeoff/drawing-analyzer doesn't hydrate the estimate
- **severity:** should
- **source:** path-1
- **step:** 2
- **assertions:** A1 (data continuity)
- **personas:** estimator
- **expected:** AI takeoff output (quantities + categorized counts) should pre-fill `estimate-wizard` line items so the estimator only adjusts; tying takeoff → estimate is the largest single re-entry friction in residential per the research.
- **actual:** `app/drawing-analyzer.tsx:150-153` is explicit: `// For now we just navigate to the estimate screen with the / hydrate an estimate is a follow-up — the AI output isn't a / 1:1 match for the EstimateBreakdown shape.` The newer `app/takeoff-estimate.tsx` flow does AI-price takeoff results into estimates, but `drawing-analyzer` still bounces the user to a blank `/estimate`.
- **repro:** 1. Open Drawing Analyzer. 2. Upload a plan PDF. 3. Tap the "drop in estimate" CTA. 4. Land on /estimate with no line items pre-filled.
- **screens / files:** `app/drawing-analyzer.tsx:144-160`, `app/estimate-wizard.tsx`, `app/takeoff-estimate.tsx` (the working alternative path).
- **scope:** M (need to map AI output schema → EstimateBreakdown.materials + .labor; then either consolidate the two entry points or hydrate from drawing-analyzer too)
- **delivery:** OTA
- **xref:** none
- **status:** confirmed-headless

### AUD-003 — Schedule wizard seeds from generic template, not estimate
- **severity:** should
- **source:** path-1
- **step:** 7
- **assertions:** A1
- **personas:** PM, scheduler, estimator
- **expected:** Schedule activities seed from estimate line items so durations and dependencies reflect scoped work. Per spec §6a: "SOV → schedule activities → budget categories share IDs."
- **actual:** `app/schedule-wizard.tsx:82-90` initializes tasks from `template.tasks.map(...)` — a hard-coded template by project type. The estimate's `materials[]` and `labor[]` arrays don't contribute. Result: schedule and estimate are loosely coupled; estimating a $40K HVAC scope doesn't surface in the schedule's HVAC activity.
- **repro:** 1. Build an estimate with notable HVAC line items. 2. Open Schedule Wizard. 3. Schedule tasks come from the template, not the estimate scope.
- **screens / files:** `app/schedule-wizard.tsx:82-198`; `types/index.ts ScheduleTask`.
- **scope:** L (depends on whether estimate line items map cleanly to schedule activities — likely needs a bridging "scope item" abstraction)
- **delivery:** OTA
- **xref:** none
- **status:** confirmed-headless

### AUD-004 — Permit status doesn't gate dependent schedule activities
- **severity:** should
- **source:** path-1
- **step:** 7
- **assertions:** A4 (schedule integration)
- **personas:** PM, super, scheduler
- **expected:** A pending or denied permit blocks (or visibly warns on) the schedule activity that depends on it (e.g. Framing inspection denied → "Frame interior walls" task gets a red flag). Competitor research #5 cites this as a common gap.
- **actual:** `app/permits.tsx` has a rich `PermitStatus` enum (`applied` → `under_review` → `approved` → various inspection states) and a permit-pipeline UI, but no schedule-task linkage. ScheduleTask has no `gatedBy: 'permit'` field; permit changes don't surface on the Gantt.
- **repro:** 1. Add a permit with status `denied`. 2. Open the schedule. 3. Tasks that depend on this permit show no warning.
- **screens / files:** `app/permits.tsx`; `app/schedule-pro.tsx`; `types/index.ts ScheduleTask`, `Permit`.
- **scope:** M (need a `linkedPermitIds` field on ScheduleTask, plus visual treatment on schedule when any linked permit is non-approved)
- **delivery:** OTA
- **xref:** consider adding to `docs/workflow-audit-roadmap.md` Tier 1 — "Permits StatusPipeline" already there, this is the next layer
- **status:** confirmed-headless

### AUD-005 — Estimate has no version / revision history
- **severity:** should
- **source:** path-1
- **step:** 3
- **assertions:** A10 (revision integrity), A8 (audit trail)
- **personas:** estimator, PM, homeowner (auditing what they signed)
- **expected:** Editing an estimate either preserves the prior version (snapshot) or is auditable so the GC can answer "the homeowner says we agreed to $X — what was the estimate when they signed?"
- **actual:** `EstimateBreakdown` interface (types/index.ts:58-74) has no `version`, `revisionHistory`, `previousVersions`, or audit fields. Updates overwrite. ProjectContract DOES have `version: number` (types/index.ts:234) which captures contract revisions, but estimate-side revisions before contract are lost.
- **repro:** 1. Build an estimate. 2. Edit a line item significantly. 3. Try to view the prior version. 4. No history available.
- **screens / files:** `types/index.ts:58-74`; `app/estimate-wizard.tsx`; `contexts/ProjectContext.tsx updateProject`.
- **scope:** M (add a versioned snapshot on estimate save; surface a "history" view)
- **delivery:** OTA
- **xref:** none
- **status:** confirmed-headless

### AUD-006 — Client-message → change-order has no conversion affordance
- **severity:** should
- **source:** path-1
- **step:** 12
- **assertions:** A1
- **personas:** PM, homeowner
- **expected:** When a homeowner messages "can we upgrade to quartz?", the GC can convert the message to a draft CO with the message body pre-filled (mirrors the selections-overage pattern at `selections.tsx:138-153`).
- **actual:** `app/client-messages.tsx` is a basic chat — `addPortalMessage` only. No router-prefill action to /change-order. The right pattern is implemented in selections.tsx but not extended here.
- **repro:** 1. Receive a portal message asking for a scope change. 2. Look for a "convert to change order" affordance. 3. None exists; GC must manually open /change-order and re-key.
- **screens / files:** `app/client-messages.tsx:60-72`; reference pattern at `app/selections.tsx:138-153`.
- **scope:** S (port the selections.tsx pattern: long-press or kebab on a portal message → router.push to /change-order with prefillReason='client_request' + prefillDescription=message.body)
- **delivery:** OTA
- **xref:** none
- **status:** confirmed-headless

### AUD-007 — Change order doesn't propagate to project budget on approval
- **severity:** should
- **source:** path-1
- **step:** 12
- **assertions:** A2 (bidirectional updates)
- **personas:** PM, homeowner
- **expected:** Approved CO updates the project's revised contract value visible in budget-dashboard / project-detail. Original `targetBudget` may stay (for variance tracking), but a "revised contract value" surface should reflect approved CO totals.
- **actual:** ChangeOrder schedule impact IS applied (project-detail.tsx:1866-1874 — A2-schedule PASS). But CO `changeAmount` doesn't write to `project.targetBudget` or any obvious "revised contract" field. Where revised contract is shown depends on linkedEstimate / aiaPayApp aggregates, which is fine for commercial but obscure for residential homeowners.
- **repro:** 1. Approve a CO with `changeAmount = 5000`. 2. Open budget-dashboard. 3. Original budget shown; revised contract not surfaced.
- **screens / files:** `app/change-order.tsx`; `app/budget-dashboard.tsx`; `contexts/ProjectContext.tsx updateChangeOrder` (line 1220+).
- **scope:** S–M (display "Original $X / Approved COs +$Y / Revised contract $Z" prominently on budget-dashboard and client-view)
- **delivery:** OTA
- **xref:** competitor complaint #6 in spec §7
- **status:** confirmed-headless

### AUD-008 — Closeout binder excludes lien waivers
- **severity:** should
- **source:** path-1
- **step:** 15
- **assertions:** A1
- **personas:** PM, homeowner, owner-commercial (more critical for commercial)
- **expected:** Closeout binder auto-includes signed lien waivers — for residential, final unconditional waivers from each major sub; for commercial, all conditional + unconditional waivers per period (legal artifact). Spec §6a step 15 lists "binder includes selections, warranties, lien waivers, photos, manuals."
- **actual:** `app/closeout-binder.tsx:58` destructures from useProjects: `commitments, warranties, projectPhotos, rfis, submittals` — no lien waivers. The lien-waivers domain object exists (`app/lien-waivers.tsx` + `utils/lienWaiverEngine`) but isn't wired into the binder compiler. Selections, warranties, submittals, photos all flow correctly.
- **repro:** 1. Project with several signed lien waivers. 2. Open closeout-binder. 3. Lien waivers are not listed.
- **screens / files:** `app/closeout-binder.tsx:58, 246-273` (compileBinder); `utils/lienWaiverEngine.ts::fetchLienWaiversForProject`.
- **scope:** S (add `fetchLienWaiversForProject(project.id)` to the Promise.all + thread into the binder data structure)
- **delivery:** OTA
- **xref:** none
- **status:** confirmed-headless

### AUD-009 — Closeout binder doesn't block on open punch items
- **severity:** should
- **source:** path-1
- **step:** 14
- **assertions:** A4
- **personas:** PM, homeowner
- **expected:** Open punch items block the binder's `status: 'delivered'` transition. A binder distributed with open punch items is a contractual problem.
- **actual:** `app/closeout-binder.tsx:317` filters `punch.filter(p => p.status !== 'closed')` and includes them as `openPunch` in the binder data, but no gating logic prevents `status='delivered'`. The binder can be marked delivered with open punch items.
- **repro:** 1. Project with open punch items. 2. Open closeout-binder. 3. Tap "Mark delivered". 4. Status changes despite open punch.
- **screens / files:** `app/closeout-binder.tsx:317-335` (deliver flow), `types/index.ts PunchItemStatus`.
- **scope:** S (add a guard on the deliver action: if `openPunch.length > 0`, show confirm dialog "This binder has N open punch items. Deliver anyway?" — soft block)
- **delivery:** OTA
- **xref:** none
- **status:** confirmed-headless

### AUD-010 — `notifications-settings.tsx` push_token update bypasses offline queue
- **severity:** defer
- **source:** domain-trace
- **step:** (n/a — Path 3 step 10 also)
- **assertions:** A7
- **personas:** all (any user updating push token)
- **expected:** All Supabase writes go through `supabaseWrite` per CLAUDE.md.
- **actual:** `app/notifications-settings.tsx:322` calls `supabase.from('profiles').update({ push_token: token }).eq('id', user.id)` directly. If offline, the update silently fails; on next launch the token re-registers anyway, so user-facing impact is near-zero.
- **repro:** Force airplane mode → toggle a notification setting → push_token write may fail without UI signal.
- **screens / files:** `app/notifications-settings.tsx:322`.
- **scope:** S (one-line replacement with `supabaseWrite('profiles', 'update', { id, push_token })`)
- **delivery:** OTA
- **xref:** AUD-001 (related)
- **status:** confirmed-headless

### AUD-011 — `submit-bid-response.tsx` insert bypasses offline queue
- **severity:** should
- **source:** domain-trace
- **step:** (n/a — Path 2 step 2 also)
- **assertions:** A7, A1
- **personas:** estimator, PM (responding to RFP)
- **expected:** Bid responses go through `supabaseWrite` so a flaky-network submission doesn't lose the bid.
- **actual:** `app/submit-bid-response.tsx:94` directly calls `supabase.from('bid_responses').insert({...})`. If the network drops mid-submit, the bid is lost.
- **repro:** Compose a bid response → simulate network drop → submit → bid is lost without queue retry.
- **screens / files:** `app/submit-bid-response.tsx:94`.
- **scope:** S (one-line replacement)
- **delivery:** OTA
- **xref:** AUD-001
- **status:** confirmed-headless

### AUD-013 — SOV is not a stable system-of-record across contract / linked-estimate / invoice / AIA pay app
- **severity:** should
- **source:** path-2
- **step:** 6
- **assertions:** A1 (data continuity), A2 (bidirectional updates), A10 (revision integrity)
- **personas:** PM, owner-commercial, sub (via pay-app gating)
- **expected:** A single Schedule of Values (SOV) record per project, where each line item has a stable ID. Schedule activities, invoice line items, AIA G703 rows, change orders, and commitments all reference SOV line items by ID. An edit to one SOV line propagates to all consumers; an approved CO either edits the SOV line or adds a new SOV line that flows through to all dependents.
- **actual:** Four distinct line-item structures with no shared identity:
  1. `ProjectContract.lineItems` — contract scope (covered by AUD-005's missing-version note for revisions).
  2. `LinkedEstimate` / `LinkedEstimateItem` — `bill-from-estimate.tsx` working state, references contract.
  3. `InvoiceLineItem` — copies into invoices.
  4. `AIASOVLine` — seeded from invoice via `seedAIAPayApplicationFromInvoice` (`utils/aiaBilling.ts`), keyed by `itemNo`.
  CO cascade therefore depends on each hop re-seeding correctly. The carry-forward at `aia-pay-app.tsx:119-130` correctly keys subsequent pay apps on `itemNo` — strong fix for one of the most-complained-about Procore behaviors. But upstream, an approved CO doesn't automatically rewrite InvoiceLineItem or LinkedEstimateItem records of in-flight invoices; the GC has to re-bill or manually adjust.
- **repro:** 1. Build a contract with 5 SOV-equivalent line items. 2. Issue an invoice billing 30% complete on item 3. 3. Approve a CO that adds a new line item 6 and modifies item 3's quantity. 4. Open the next month's AIA pay app. 5. Verify whether item 3's revised total + the new item 6 appear correctly without manual re-entry.
- **screens / files:** `app/contract.tsx`, `app/bill-from-estimate.tsx`, `app/invoice.tsx`, `app/aia-pay-app.tsx`, `utils/aiaBilling.ts`, `types/index.ts` (ProjectContract, LinkedEstimate, Invoice, SavedAIAPayApp, ChangeOrder).
- **scope:** L (introducing a unified SOV record with stable line-item IDs is non-trivial; could be incremental — start by ensuring approved COs propagate to LinkedEstimate as new lines, since that's where downstream cascading begins)
- **delivery:** OTA
- **xref:** competitor universal complaint #6 in spec §7
- **status:** confirmed-headless (multi-hop chain confirmed; whether each hop re-seeds in practice is Phase 2)

### AUD-012 — `post-rfp.tsx` insert bypasses offline queue
- **severity:** defer
- **source:** domain-trace
- **step:** (n/a)
- **assertions:** A7
- **personas:** owner-commercial, owner-residential (posting an RFP)
- **expected:** RFP posting goes through `supabaseWrite`.
- **actual:** `app/post-rfp.tsx:221` directly calls `supabase.from('public_bids').insert({...})`. RFP posting is rare-flow, so impact is small, but consistency-wise should match.
- **repro:** Same pattern as AUD-011.
- **screens / files:** `app/post-rfp.tsx:221`.
- **scope:** S
- **delivery:** OTA
- **xref:** AUD-001
- **status:** confirmed-headless



## 6. Hardware verification runbook

_Compiled in Task 8 for the user to execute on the iOS production OTA build._

(empty — populated by Task 8)

## 7. Triage filter views

_Generated in Task 9 after all findings are tagged with severity, scope, delivery._

(empty — populated by Task 9)
