# MAGE ID — Pre-Launch Workflow Audit (Design Spec)

**Date:** 2026-05-07
**Status:** design approved, ready for implementation plan
**Author:** Omir Majeed + Claude (brainstorm pair)
**Related:**
- `docs/workflow-audit-roadmap.md` — existing UX-pattern audit (StatusPipeline, carry-forward, progress indicator, voice). Complementary to this spec, not duplicative.
- `CLAUDE.md` — project conventions; this audit operates within them.

---

## 1. Charter

### Goal
Verify that MAGE ID's shipped workflows hold up end-to-end across every primary persona — that data flows continuously between screens, that the right person sees the right slice, that the field-to-office handoffs don't lose information, and that the table-stakes features competitor users complain about most are not missing or broken.

### Mode
**Pre-launch lock-in.** Output is a ranked punch list driving the final 2–3 weeks of work before App Store submission. Not a roadmap; not a feature design; not a UX rewrite.

### In scope
- End-to-end data continuity between screens, contexts, and edge functions.
- Cross-persona handoffs (GC ↔ super ↔ homeowner ↔ commercial owner ↔ sub).
- Permissions and portal scope segregation.
- Notification routing and noise.
- Offline queue behavior on reconnect.
- Audit trail and revision integrity for money-bearing artifacts.
- Mobile parity for primary field workflows (assertion A6).
- Comparison against the 30 most-cited complaints across major competitor PM apps.

### Out of scope (audit will surface findings but not fix)
- AI feature output quality (separate effort).
- Performance / render speed tuning.
- Visual polish, copy, animation.
- New-feature gap analysis (the audit may note missing features but does not prescribe them).
- The UX-pattern items already tracked in `docs/workflow-audit-roadmap.md` — those have their own rollout phases and we will not double-track them. Where this audit's findings overlap, we cross-reference rather than duplicate.

### Primary personas (all first-class at launch)
1. **GC internal team** — PM, superintendent, scheduler, estimator, controller/admin.
2. **Commercial owner / owner's rep.**
3. **Residential homeowner.**
4. **Subcontractor** (via portal).
5. **Architect** (via portal — read/respond on RFIs and submittals).

### Time horizon
~14–19 hours of focused work over ~3 working days. Three-pillar methodology, headless-first execution. See §8 for phase breakdown.

---

## 2. Methodology — three pillars

### Pillar A — Golden-path walkthroughs (UX continuity)
Three canonical project journeys walked end-to-end. Each step names the acting persona, the screens / edge functions touched, and the expected hand-off. Designed to surface UX-level breaks: missing screens, dead-end flows, screens that render but don't connect.

### Pillar B — Per-step assertion rubric (data flow)
Every step in every path is checked against the same 10 assertions (A1–A10, defined in §5). Designed to surface data-flow level breaks: re-entry, lost data, broken bidirectional updates, missing audit trail, permission slips.

### Pillar C — Competitor table-stakes checklist (sanity check)
30 most-cited complaints across 12 major construction PM apps (Procore, Buildertrend, JobTread, Houzz Pro, BuildBook, CompanyCam, Fieldwire, Raken, Knowify, PlanGrid/Bluebeam, Autodesk Construction Cloud, BuildOps), deduplicated and ranked. Run last to catch table-stakes outside the three scripted paths.

---

## 3. Deliverables

### Two artifacts
1. **This design spec** — `docs/superpowers/specs/2026-05-07-prelaunch-workflow-audit-design.md` (locks methodology before any walkthrough starts).
2. **Living audit doc** — `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` (produced by executing the plan; checked into the repo so progress is visible in git).

### Living audit doc structure
```
1. Charter           — scope, methodology, what's in/out (1 page)
2. Golden-path runs  — three scripts walked end-to-end, evidence inline
3. Domain-object     — one row per object: created/edited/derived/flows-to
   lifecycle index
4. Competitor        — 30 table-stakes items, green/yellow/red vs. MAGE ID
   table-stakes
5. Punch list        — every finding, ranked
```

### Per-finding schema
| field | values |
|---|---|
| `id` | stable, e.g. `AUD-007` |
| `severity` | `block` / `should` / `defer` |
| `source` | `path-1` / `path-2` / `path-3` / `domain-trace` / `competitor-check` |
| `step` | step number in the source |
| `assertions` | which of A1–A10 failed |
| `personas` | PM, super, scheduler, estimator, owner-commercial, owner-residential, sub, architect |
| `repro` | exact steps to reproduce |
| `expected vs actual` | one line each |
| `screens / files` | clickable repo paths |
| `scope` | S (<1d) / M (1–3d) / L (>3d) |
| `delivery` | `OTA` / `needs new build` |
| `xref` | optional cross-reference to `docs/workflow-audit-roadmap.md` if overlapping |

### Three filter views (not separate docs)
- *Blocks the store* → `severity = block`
- *First post-launch sprint* → `severity = should AND scope ≤ M`
- *Defer* → everything else

---

## 4. Severity rubric

| Severity | Trigger |
|---|---|
| **block** | (a) A1 / A2 / A8 fail on a money-bearing or contract-bearing artifact (estimate, SOV, contract, CO, pay app, invoice, lien waiver). (b) A6 fail on a primary field workflow (daily report, photo, RFI, submittal, punch, time tracking, payment). (c) Crash or empty/non-functional screen on a primary-persona route. (d) A3 cross-persona leakage (sub seeing another sub's data, homeowner seeing internal markup, etc.) — confidentiality/legal severity. |
| **should** | A3 / A4 / A5 / A9 / A10 partial failures; A6 fail on secondary admin screen; friction or missing affordance a competitor user notices in week 1; recoverable via a workaround. |
| **defer** | A7 edge cases that don't lose data; A10 edge cases on rare revision flows; polish, copy, alignment, animation; A6 on portfolio/admin views legitimately desktop-only. |

---

## 5. Per-step assertion rubric (A1–A10)

Every step in every path is checked against these 10 assertions.

| ID | Assertion | What it tests |
|---|---|---|
| **A1** | Data continuity | Prior step's data carries forward without re-typing (lead → estimate, estimate → SOV → schedule → pay app, etc.). |
| **A2** | Bidirectional updates | Downstream change propagates upstream (CO edits SOV + schedule + budget; paid invoice updates cash flow; sub waiver updates pay app gate). |
| **A3** | Persona visibility | Right persona sees the right slice (sub sees only their scope; homeowner sees only what's shared; cross-sub leakage = fail). |
| **A4** | Schedule integration | Step reflects on the Gantt/timeline if it should (submittal status, RFI, CO, permit status, punch all gate or annotate schedule). |
| **A5** | Notification routing | Right person notified at right time, without spam; quiet hours respected. |
| **A6** | Mobile parity *(global)* | Step is doable on iOS app, not just web. |
| **A7** | Offline behavior *(sampled per path)* | At designated steps: airplane mode + complete step + reconnect = clean reconcile, no data loss, no duplicate writes. |
| **A8** | Audit trail | Action is attributable to a user with timestamp; visible in a per-record history. |
| **A9** | Permission isolation | Wrong persona is blocked from this step (sub can't trigger pay app; homeowner can't edit SOV). |
| **A10** | Revision integrity | If this step's input changes (estimate revised, CO edited, SOV adjusted), prior derivations either remain valid or revalidate cleanly — no orphaned references. |

---

## 6. Golden paths

### 6a. Path 1 — Homeowner Kitchen Remodel (residential)
**Personas:** estimator/PM (small shop), super, homeowner.
**Start state:** empty seeded account, one inbound lead.
**End state:** signed handover, paid in full, warranty active.

| # | Persona | Step | Screen / fn | Hand-off to verify |
|---|---|---|---|---|
| 1 | Estimator | Qualify lead | `leads` → `lead-detail` | Lead carries client name, address, scope notes to estimate without re-typing |
| 2 | Estimator | Takeoff from photos/plans | `takeoff`, `drawing-analyzer`, `analyze-takeoff` fn | Quantities seed estimate line items |
| 3 | Estimator | Build estimate | `estimate-wizard` | Revisions tracked with version history (not overwriting prior) |
| 4 | Estimator | Material buyout / PO | `buyout` | Quantities flow from takeoff → PO without re-calculating |
| 5 | Homeowner | Review estimate | `client-portal-setup` invite → `client-view` | Same line items + totals as estimator sees |
| 6 | Both | Sign contract | `contract` | Contract derives from estimate (no re-entry); schedule-of-values seeds from line items |
| 7 | PM | Project init + permits | `project-detail`, `schedule-wizard`, `permits` | SOV → schedule activities → budget categories share IDs; permit status gates dependent schedule activities |
| 8 | Homeowner | Selections (the #1 residential pain) | `selections` | Pick → updates budget → shows cost in client portal → flows to next invoice line item. Each pick ties to estimate line + flags missed picks |
| 9 | PM | Pre-con docs | `plans`, `project-files` | Documents visible to homeowner per portal permissions |
| 10 | Super | Daily ops | `daily-report`, `photo-annotator`, `photo-triage`, `time-tracking` | Photos auto-tag to project + room/phase; time entries flow to job costing without re-entry into payroll |
| 11 | System | Weekly digest to homeowner | `homeowner-weekly-digest` fn → `client-update` | Digest pulls from week's reports + photos automatically (no manual curation) |
| 12 | Homeowner→PM | Stone upgrade request | `client-messages` → `change-order` | Message converts to CO; CO actually updates schedule + budget (not standalone doc); portal shows pending approval |
| 13 | Both | Progress invoice | `bill-from-estimate` → `create-payment-link` fn → Stripe → `stripe-webhook` fn | Invoice draws from completed line items; paid status posts back to budget + cash flow without manual reconciliation |
| 14 | Super | Punch | `punch-walk` (or `ai-punch`), `punch-list` | Items visible to homeowner in portal; open items block closeout |
| 15 | PM | Warranty + handover | `warranty-walk` → `warranties`, `handover`, `closeout-binder` | Binder includes selections, warranties, lien waivers, photos, manuals |

**Designated A7 (offline) interventions:** step 10 (daily ops with photos), step 13 (progress invoice).

### 6b. Path 2 — Commercial Tenant Fit-Out
**Personas:** estimator, PM, super, scheduler, owner's rep, sub (via portal), architect (via portal).
**Start state:** open RFP visible in marketplace.
**End state:** closeout binder delivered, retention released, all unconditional final waivers collected.

| # | Persona | Step | Screen / fn | Hand-off to verify |
|---|---|---|---|---|
| 1 | PM | RFP intake | `nearby-rfps` / `my-rfps` → `rfp-detail` | Spec book parses to a checklist |
| 2 | Estimator | Bid response | `submit-bid-response`, `extract-submittals`, `analyze-spec-book` fn, `estimate-wizard` | Estimate carries spec items into a submittal log placeholder |
| 3 | Owner's rep | Award | `rfp-responses-review` → `award-rfp` fn → `bid-detail` | Award triggers contract draft; loser bidders notified |
| 4 | Owner / Sub | Prequal + COI | `prequal-form`, `prequal-manager`, `coi-vault`, `coi-expiry-watch` fn | Package = W-9 + COI + EMR + bond + financials + 3 refs; federated sub profile (sub doesn't re-upload across GCs in MAGE ID) |
| 5 | Both | AIA contract | `contract` (A101 / A201) | Notice-to-proceed issued; schedule-of-values explicit handoff to step 6 |
| 6 | PM | SOV creation | (within `project-detail` or `aia-pay-app` setup) | SOV is the system-of-record; schedule activities + pay app rows + CO log all reference SOV by line-item ID |
| 7 | PM | Project init + Gantt | `project-detail`, `schedule-pro` | Critical path computed; long-lead items flagged |
| 8 | PM/Sub | Long-lead submittals first | `submittal` (auto-populated from step 2) | Long-lead submittals flagged on critical path; status gates the dependent schedule activity |
| 9 | PM | Buyout + sub onboarding | `buyout`, `buyout-package`, `sub-portal-setup` → `sub-portals` | Subs see only their scope, not whole project (audit verifies no cross-sub leakage) |
| 10 | Sub→GC→A/E→Owner | Submittals (full) | `submittal` | Statuses: Submitted → GC Review → Sent to A/E → "No Exceptions Taken" / "Make Corrections Noted" / "Revise & Resubmit" / "Rejected"; status blocks dependent schedule activity |
| 11 | Super→A/E | RFIs | `rfi` | 5-working-day SLA tracked; overdue surfaces on schedule + OAC; RFI ↔ CO link preserved (RFI can convert to CO without losing the lineage) |
| 12 | Super | Daily ops + scheduling | `daily-report`, `schedule-pro` | Manpower + weather feeds back to schedule actuals |
| 13 | All | Weekly OAC meeting | `oac-meeting` | Auto-aggregates: attendance, open RFIs, submittal status, CO log, 2-week look-ahead, schedule slip, manpower, safety, action items, next meeting |
| 14 | PM/Owner | Change orders | `change-order` | CO is additive (prior CO math preserved on edit); routes to owner; updates SOV + schedule on approval |
| 15 | PM→Owner | AIA pay app (G702/G703) | `aia-pay-app`, `lien-waivers`, `retention` | Pulls SOV % complete from schedule + super's reports; pay app submission BLOCKED until conditional waivers from all billing subs received ("waivers received: 3/5"); prior pay app continuity preserved |
| 16 | PM | Job costing & cash | `job-costing`, `cash-flow`, `payment-predictions` | Pay app submission updates cash flow forecast |
| 17 | Both | Substantial completion | `punch-walk` → `punch-list` | Punch list signed off; retainage release eligibility flag fires |
| 18 | All | Closeout | `closeout-binder`, `handover`, `warranties`, `lien-waivers` | Binder pulls submittals, RFIs, COs, unconditional final waivers, warranties, final pay app, O&M manuals, as-builts |

**Designated A7 (offline) interventions:** step 11 (RFI submission), step 15 (pay app submission).

### 6c. Path 3 — Internal GC Operations (cross-project office side)
**Personas:** PM/controller, estimator, scheduler, company admin.
**Start state:** Paths 1+2 already seeded and partially advanced (otherwise portfolio dashboards look empty).
**End state:** verified that office views stay in sync with field activity from concurrent projects.

| # | Persona | Step | Screen / fn | Hand-off to verify |
|---|---|---|---|---|
| 1 | Estimator | Bid pipeline | `mage-id-bids`, `leads` | Wins move to active project automatically |
| 2 | PM | Portfolio budget | `budget-dashboard` | Aggregates per-project budgets correctly |
| 3 | PM | Job costing rollup | `job-costing` | Field time + invoices roll up |
| 4 | PM | Cash flow forecast | `cash-flow`, `payment-predictions` | All open AIA pay apps + invoices feed in |
| 5 | PM | Buyout pipeline | `buyout` | Commitments cross-project |
| 6 | Admin | Sub management | `sub-portals`, `prequal-manager`, `coi-vault` | Federated sub profile across projects; COI expiry dashboard with 30-day-pre-expiry auto-email; sub portal shows only that sub's slice across all projects (audit-tested for leakage) |
| 7 | Super/Admin | Time | `time-tracking` | Hours flow to job costing per project |
| 8 | Admin | 1099 / tax | `tax-1099-export` | Pulls full year's sub payments |
| 9 | All | Reports | `reports`, `report-inbox`, `data-export`, `weekly-snapshot` | Each consumer's morning email fires correctly; data export includes audit trail + attachments (no flat-CSV-only) |
| 10 | All | Notifications | `notifications-inbox`, `morning-digest` fn, `daily-digest` fn, `notifications-settings` | Granular by project, role, type; quiet hours respected; right person, right project, right time |
| 11 | Admin | Equipment | `equipment`, `equipment-detail` | Equipment tied to projects + costs |
| 12 | Admin | Marketplace | `marketplace`, `discover`, `post-job` | Inbound leads feed step 1 |
| 13 | Admin | Integrations | `integrations`, `payments-setup` | Bidirectional accounting sync (QuickBooks etc) — invoice posts both ways without re-key; Stripe Connect status accurate |
| 14 | Admin | Audit trail | (cross-app) | Every state-changing action shows who/what/when in a per-record history view |
| 15 | Admin | Account hygiene | `delete-account` fn, `paywall` | Deletion fully wipes; tier downgrade revokes feature access correctly |

**Designated A7 (offline) interventions:** step 7 (time-tracking entry), step 9 (data export request).

---

## 7. Competitor table-stakes checklist (30 items)

Sourced from G2 / Capterra / TrustRadius / Reddit critical reviews of 12 PM apps, deduplicated and ranked by frequency. Run after all three paths are walked. Each item gets green / yellow / red against MAGE ID with a notes field.

### Theme weighting
| Theme | # complaints | Audit weight |
|---|---|---|
| Mobile UX | 11 | Heavy — covered by A6 global rule |
| Integration / Money Flow | 8 | Heavy — covered by Paths 1/2 + A1/A2 |
| Offline | 6 | Medium — A7 sampled per path |
| Notifications | 5 | Medium — A5 |
| Permissions | 5 | Medium — A3/A9 |
| Onboarding | 4 | Medium — verified in path setup phase |
| Schedule integration | 4 | Medium — A4 |
| Pricing / lock-in | 4 | Light — covered by data-export check + paywall flow |
| Sub / Client portal | 4 | Heavy — covered by Paths 1/2 portal handoffs |
| AI | 1 | Light — out-of-scope per §1 |

### The 30 items (universal across 5+ apps marked **U**; high-frequency 3–4 apps marked **H**; moderate 2 apps marked **M**)

| # | Tier | Theme | Complaint |
|---|---|---|---|
| 1 | **U** | Mobile UX | Mobile app slower / fewer features than desktop |
| 2 | **U** | Offline | Offline sync breaks; photos/reports fail to upload on reconnect |
| 3 | **U** | Notifications | Notifications too noisy; no granular control or quiet hours |
| 4 | **U** | Mobile UX | Desktop-to-mobile feature parity broken |
| 5 | **U** | Permissions | No per-field permission control; roles too coarse |
| 6 | **U** | Money flow | Estimate → budget → invoice → payment flow disconnected |
| 7 | **U** | Money flow | Cost-code double-entry across modules |
| 8 | **U** | Client portal | Client portal has low adoption; clients skip it for email |
| 9 | **U** | Onboarding | New project takes weeks to set up; import is manual/error-prone |
| 10 | **U** | Schedule | Schedule disconnected from RFI, punch list, change orders |
| 11 | **H** | Sub portal | Subcontractor portal has permission gaps or upload limits |
| 12 | **H** | Offline | Mobile app crashes on poor connectivity or after long offline periods |
| 13 | **H** | Pricing | Pricing opaque; per-user fee or surprise add-on markup |
| 14 | **H** | Mobile UX | Search/find broken; can't locate documents, RFIs, or submittals |
| 15 | **H** | Pricing/lock-in | Data export non-viable; history/attachments don't travel |
| 16 | **H** | Offline | Sync conflicts between web and mobile; data overwrites |
| 17 | **H** | Integration | API integrations weak; required middleware for accounting/payroll |
| 18 | **H** | Money flow | Change order workflow rigid; must close previous to start new |
| 19 | **H** | Mobile UX | Mobile UX for complex tasks (daily reports, RFIs) broken |
| 20 | **H** | Notifications | Notification doesn't reach right person; no role-based routing |
| 21 | **M** | Mobile UX | Photo tagging/annotation slow or unsupported on mobile |
| 22 | **M** | Schedule | Daily report time entries not deducted from schedule or budget |
| 23 | **M** | Sub portal | Sub can see too much or too little on portal |
| 24 | **M** | Onboarding | Template library bare or not reusable across projects |
| 25 | **M** | Permissions | Audit trail hidden or incomplete; no version history |
| 26 | **M** | AI | AI features hallucinate or give false confidence |
| 27 | **M** | Pricing | Contract auto-renewal or long lock-in; early exit penalty |
| 28 | **M** | Onboarding | Invite/onboarding flow confusing; activation emails fail |
| 29 | **M** | Notifications | In-app messaging separate from email; users miss context |
| 30 | **M** | Mobile UX | Bulk actions (assign, status change, delete) not available on mobile |

---

## 8. Execution plan

### Headless-first model
The audit runs in three phases. Claude executes Phase 1 by reading code; user executes Phase 2 with hardware; both collaborate on Phase 3 triage.

### Phase 1 — Headless audit (Claude, ~10–12 hours)
For every step of every path, Claude:
- Reads the relevant screen file, context handler, edge function, RLS policy, tier gate, and notification handler.
- Predicts expected behavior and runs the 10 assertions (A1–A10) where they can be evaluated from code.
- Tags each finding `confirmed-headless` (clear from code), `predicted-needs-verification` (code suggests issue but hardware confirms), or `hardware-only-pending` (cannot evaluate without device, e.g. push notification arrival, IAP, biometric, camera).
- Writes findings into the living audit doc as work proceeds (not at end).

Assertions evaluated headlessly:
- A1, A2, A8, A10 — fully (read code paths, mutations, audit columns, references).
- A3, A4, A5, A9 — mostly (read RLS, portal filters, tier gates, notification routing logic).
- A6, A7 — partially (read for desktop-only imports, queue logic; flag for hardware verification).

Domain-object lifecycle index (audit doc §3) compiled in this phase.

### Phase 2 — Hardware verification (user, ~3–5 hours)
User runs the iOS-only / hardware-required items on the **production OTA build** (not dev) so the audit reflects exactly what the App Store will receive:
- A6 mobile parity spot-checks for primary field workflows.
- A7 airplane-mode interventions at the 6 designated steps (2 per path).
- Push notification arrival, Stripe IAP, biometric auth, camera permission, deep link.
- Confirms or refutes Phase 1's `predicted-needs-verification` findings.

Pre-flight (before Phase 2):
1. Build a fresh OTA bundle on the production EAS profile.
2. Use `dev-seeder` to seed three test orgs (residential GC, commercial GC, parallel client/sub set).
3. Two iPhones on hand: GC persona + client/sub persona. Plus desktop browser tab.

### Phase 3 — Triage (joint, ~1–2 hours)
- Apply severity rubric (§4) to all findings.
- Tag scope (S/M/L) and delivery (OTA / new build).
- Generate three filter views (block; should + scope ≤ M; defer).
- Cross-reference findings to `docs/workflow-audit-roadmap.md` items where they overlap.
- Final audit doc committed with message `audit: pre-launch lock-in pass complete`.

### Path execution order
1. Path 1 (residential) — simpler, fewer personas. ~3–4 hrs across phases.
2. Path 2 (commercial) — most personas, exercises AIA/SOV/RFI/submittal/pay-app spine. ~5–6 hrs.
3. Path 3 (office) — runs last because it depends on Paths 1+2 having seeded portfolio data. ~2–3 hrs.

### Designated airplane-mode interventions (A7)
| Path | Step | Action under airplane mode |
|---|---|---|
| 1 | 10 | Daily report submission with 5 photos |
| 1 | 13 | Progress invoice creation |
| 2 | 11 | RFI submission |
| 2 | 15 | Pay app submission |
| 3 | 7 | Time-tracking entry |
| 3 | 9 | Data export request |

For each: complete the action offline → reconnect → verify clean reconcile, no data loss, no duplicate writes.

### Time estimate (total)
- Phase 1 (Claude headless): 10–12 hrs
- Phase 2 (user hardware): 3–5 hrs
- Phase 3 (joint triage): 1–2 hrs
- **Total: 14–19 hrs over ~3 working days**

---

## 9. Relationship to existing roadmap

`docs/workflow-audit-roadmap.md` is a **UX-pattern audit** — what components every workflow screen should use (StatusPipeline, carry-forward, progress indicator, voice). This spec is a **data-flow + integration audit** — what should travel between screens, personas, and modules.

The two are complementary, not duplicative. Where this audit's findings overlap with items already in the roadmap (e.g. "AIA pay app needs carry-forward from prior period"), the per-finding `xref` field points to the roadmap item and we do not double-track.

When the audit surfaces a UX-pattern fix that the roadmap hasn't yet captured (e.g. "selections screen needs progress indicator"), it goes into the punch list AND a roadmap update is added to Phase 3 of triage.

---

## 10. Success criteria

The audit is complete when:
1. All three golden paths walked end-to-end across all 10 assertions.
2. All 30 competitor table-stakes items rated green/yellow/red.
3. Domain-object lifecycle index built for every money-bearing artifact.
4. Every finding has severity, scope, delivery, and (where overlapping) xref tagged.
5. Three filter views (block / should ≤ M / defer) generated and reviewed.
6. Audit doc committed to git.

After completion, the brainstorming flow hands off to the `writing-plans` skill, which produces the implementation plan that drives the actual punch-list fixes.

---

## Appendix — file/path references

Screens (selected primary):
`app/leads.tsx`, `app/lead-detail.tsx`, `app/estimate-wizard.tsx`, `app/takeoff.tsx`, `app/drawing-analyzer.tsx`, `app/contract.tsx`, `app/project-detail.tsx`, `app/schedule-wizard.tsx`, `app/schedule-pro.tsx`, `app/permits.tsx`, `app/selections.tsx`, `app/buyout.tsx`, `app/buyout-package.tsx`, `app/daily-report.tsx`, `app/photo-annotator.tsx`, `app/photo-triage.tsx`, `app/time-tracking.tsx`, `app/change-order.tsx`, `app/invoice.tsx`, `app/bill-from-estimate.tsx`, `app/punch-list.tsx`, `app/punch-walk.tsx`, `app/ai-punch.tsx`, `app/warranty-walk.tsx`, `app/warranties.tsx`, `app/handover.tsx`, `app/closeout-binder.tsx`, `app/client-portal-setup.tsx`, `app/client-view.tsx`, `app/client-update.tsx`, `app/client-messages.tsx`, `app/sub-portal-setup.tsx`, `app/sub-portals.tsx`, `app/prequal-form.tsx`, `app/prequal-manager.tsx`, `app/coi-vault.tsx`, `app/submittal.tsx`, `app/extract-submittals.tsx`, `app/rfi.tsx`, `app/aia-pay-app.tsx`, `app/lien-waivers.tsx`, `app/retention.tsx`, `app/oac-meeting.tsx`, `app/budget-dashboard.tsx`, `app/job-costing.tsx`, `app/cash-flow.tsx`, `app/payment-predictions.tsx`, `app/data-export.tsx`, `app/reports.tsx`, `app/notifications-inbox.tsx`, `app/notifications-settings.tsx`, `app/integrations.tsx`, `app/payments-setup.tsx`, `app/tax-1099-export.tsx`, `app/paywall.tsx`.

Edge functions (selected primary):
`supabase/functions/award-rfp/`, `supabase/functions/coi-expiry-watch/`, `supabase/functions/create-payment-link/`, `supabase/functions/stripe-webhook/`, `supabase/functions/homeowner-weekly-digest/`, `supabase/functions/morning-digest/`, `supabase/functions/daily-digest/`, `supabase/functions/notify/`, `supabase/functions/analyze-takeoff/`, `supabase/functions/analyze-spec-book/`, `supabase/functions/delete-account/`, `supabase/functions/usage-status/`.

Contexts:
`contexts/AuthContext.tsx`, `contexts/ProjectContext.tsx`, `contexts/BidsContext.tsx`, `contexts/CompaniesContext.tsx`, `contexts/HireContext.tsx`, `contexts/NotificationContext.tsx`, `contexts/SubscriptionContext.tsx`.

Offline queue:
`utils/offlineQueue.ts` (single chokepoint for all Supabase writes).

Tier gating:
`hooks/useTierAccess.ts` (client), `supabase/functions/_shared/auth.ts` `requireTier` (server).
