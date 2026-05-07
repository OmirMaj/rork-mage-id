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

(empty — populated by Task 3)

### 2.2 Path 2 — Commercial tenant fit-out

_Walked in Tasks 4 + 5. Step results listed below._

(empty — populated by Tasks 4 + 5)

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

**Finding ID counter:** next is AUD-002.

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



## 6. Hardware verification runbook

_Compiled in Task 8 for the user to execute on the iOS production OTA build._

(empty — populated by Task 8)

## 7. Triage filter views

_Generated in Task 9 after all findings are tagged with severity, scope, delivery._

(empty — populated by Task 9)
