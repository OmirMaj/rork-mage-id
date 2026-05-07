# Pre-Launch Workflow Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the pre-launch workflow audit specified in `docs/superpowers/specs/2026-05-07-prelaunch-workflow-audit-design.md`, producing a living audit doc and a ranked punch list of findings ready for the final 2–3 weeks of pre-launch work.

**Architecture:** Headless-first execution. Claude reads code paths (screens, contexts, edge functions, RLS policies, tier gates, notification handlers) to evaluate assertions A1–A5 + A8–A10 across three golden paths and the 30-item competitor checklist. A6 (mobile parity) and A7 (offline) are partial-headless and partial-hardware: Claude predicts behavior from code, the user verifies on iOS afterwards using the runbook produced in Task 8. All findings live in one document and get committed per task so progress is visible in git.

**Tech Stack:** Repo file reads via Claude Code's `Read` and `Bash` tools (grep, ripgrep). No code is written by this plan — output is markdown findings. Authoritative source for methodology is the spec; this plan tells the executor what to read, in what order, and what to write.

---

## Conventions used by this plan

**Finding template** — every entry in the punch list uses this exact schema (defined in spec §3):

```markdown
### AUD-### — short title
- **severity:** block | should | defer
- **source:** path-1 | path-2 | path-3 | domain-trace | competitor-check
- **step:** N (when source is a path) — empty otherwise
- **assertions:** A1, A2, ... (which of A1–A10 failed)
- **personas:** PM, super, scheduler, estimator, owner-commercial, owner-residential, sub, architect
- **expected:** one-liner
- **actual:** one-liner
- **repro:** numbered steps to reproduce on the running app
- **screens / files:** repo paths
- **scope:** S | M | L
- **delivery:** OTA | needs-new-build
- **xref:** docs/workflow-audit-roadmap.md item title (only if overlapping; otherwise empty)
- **status:** confirmed-headless | predicted-needs-verification | hardware-only-pending
```

**ID assignment** — findings get sequential IDs starting at AUD-001 in the order they're added to the audit doc. Maintain a running counter at the top of §5 of the audit doc.

**Per-step result line** — in §2 of the audit doc (golden-path runs), each step gets one line:
```
Step N: [PASS] all assertions | [FAIL] A1, A2 → AUD-007, AUD-008 | [N/A: hardware] A6 → see runbook §X
```

**Commit message convention** — `audit: <task description>`. One commit per completed task.

**Spec is authoritative** — when the plan and spec conflict, the spec wins; flag the discrepancy in chat before continuing.

---

## File Structure

This plan touches three files in this repo and reads from many. Layout:

| Path | Role | Created in |
|---|---|---|
| `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` | Living audit doc — the deliverable | Task 1 |
| `docs/superpowers/plans/2026-05-07-prelaunch-workflow-audit.md` | This plan | Already exists |
| `docs/superpowers/specs/2026-05-07-prelaunch-workflow-audit-design.md` | Spec (authoritative) | Already exists |

The audit doc has 5 sections per spec §3:
1. Charter (copied from spec)
2. Golden-path runs (Tasks 3, 4, 5, 6 write into this)
3. Domain-object lifecycle index (Task 2)
4. Competitor table-stakes (Task 7)
5. Punch list (every task may add findings here)

---

## Task 1: Bootstrap the audit doc

**Files:**
- Create: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md`

- [ ] **Step 1: Create the audit doc with all 5 section skeletons in place**

Write the following to `docs/superpowers/audits/2026-05-07-prelaunch-audit.md`:

```markdown
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

_Built in Task 2. One row per object: created where → edited where → derived from → flows to._

(empty — populated by Task 2)

## 4. Competitor table-stakes

_Walked in Task 7. 30-item checklist from spec §7 with green/yellow/red status against MAGE ID._

(empty — populated by Task 7)

## 5. Punch list

_All findings, all sources. Use the finding template defined in the plan. Sort by AUD-### ascending._

(empty — populated by Tasks 2–7 + 9)

## 6. Hardware verification runbook

_Compiled in Task 8 for the user to execute on the iOS production OTA build._

(empty — populated by Task 8)

## 7. Triage filter views

_Generated in Task 9 after all findings are tagged with severity, scope, delivery._

(empty — populated by Task 9)
```

- [ ] **Step 2: Verify the file was written and is the size you expect**

Run: `wc -l "docs/superpowers/audits/2026-05-07-prelaunch-audit.md"`
Expected: ~50 lines.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md docs/superpowers/plans/2026-05-07-prelaunch-workflow-audit.md
git commit -m "audit: bootstrap doc skeleton + plan"
```

---

## Task 2: Build the domain-object lifecycle index

**Goal:** populate audit doc §3 with one row per money-bearing or contract-bearing domain object. This anchors later assertion checks: when walking Path 2 step 6 (SOV creation), we can verify SOV's lifecycle row matches the actual code.

**Files:**
- Modify: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` §3
- Read: `types/index.ts` (single source of truth for domain types per CLAUDE.md), all `contexts/*.tsx`, relevant edge functions for derivation logic.

- [ ] **Step 1: Read `types/index.ts` end-to-end**

Run: `Read types/index.ts`
Identify every exported type that represents a money-bearing or contract-bearing artifact, plus core workflow objects.

Domain objects to index (from spec §6 + CLAUDE.md state list + types):
- Lead
- Estimate
- Contract
- ScheduleOfValues (SOV) row
- ScheduleActivity / ScheduleTask
- Permit
- Selection
- DailyReport
- Photo
- TimeEntry
- ChangeOrder
- Invoice
- Payment
- RFI
- Submittal
- AIAPayApp (G702 + G703 line items)
- LienWaiver
- PunchItem
- Warranty
- COI / CertificateOfInsurance
- PrequalSubmission
- OACMeeting
- Bid / RFP response

- [ ] **Step 2: For each domain object, fill in this row template**

For each object, determine four facts by reading the codebase:

```markdown
| Object | Created in | Edited in | Derived from | Flows to | AsyncStorage key | Notes |
```

- **Created in** — which screen/edge function instantiates a new instance (e.g. Estimate is created in `app/estimate-wizard.tsx`).
- **Edited in** — every other screen that mutates it (grep for the type name in `app/`).
- **Derived from** — what upstream object provided its initial values (Estimate → Contract derives line items; SOV → AIAPayApp G703 rows derive % complete).
- **Flows to** — which downstream objects reference or consume this one.
- **AsyncStorage key** — `buildwise_*` (legacy) or `tertiary_*` (newer) per CLAUDE.md.
- **Notes** — anything unusual: doesn't go through `utils/offlineQueue.ts`, lacks audit-trail columns, etc.

Use grep to find references:
```bash
rg -n "type Estimate\b|interface Estimate\b" types/
rg -n "Estimate\b" app/ contexts/ supabase/functions/
```

Repeat for each object.

- [ ] **Step 3: Write the index into audit doc §3**

Replace the `(empty — populated by Task 2)` line with a markdown table containing one row per object. ~22 rows expected.

If during the read you find an object that lacks audit-trail columns, lacks an `updated_at` field, or bypasses `utils/offlineQueue.ts`, file a finding **immediately** using the template — don't wait for path walks. These are domain-trace findings; tag `source: domain-trace`, `step: empty`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md
git commit -m "audit: domain-object lifecycle index"
```

---

## Task 3: Path 1 walk — Homeowner kitchen remodel (residential)

**Goal:** walk all 15 steps of Path 1 from spec §6a, evaluating assertions A1–A5 + A8–A10 headlessly, predicting A6/A7 from code (flagging `predicted-needs-verification` for hardware confirmation), logging findings as we go.

**Files:**
- Modify: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` §2.1 + §5
- Read: every screen and edge function listed in the spec §6a path table.

**Reference:** Spec §6a contains the full step table. Spec §5 defines A1–A10.

- [ ] **Step 1: Open the spec §6a Path 1 table side-by-side with the audit doc §2.1**

Run: `Read docs/superpowers/specs/2026-05-07-prelaunch-workflow-audit-design.md offset 6a-section`

Confirm step list:
1. Qualify lead (`leads`, `lead-detail`)
2. Takeoff (`takeoff`, `drawing-analyzer`, `analyze-takeoff` fn)
3. Build estimate (`estimate-wizard`)
4. Material buyout (`buyout`)
5. Review estimate (`client-portal-setup` invite → `client-view`)
6. Sign contract (`contract`)
7. Project init + permits (`project-detail`, `schedule-wizard`, `permits`)
8. Selections (`selections`) — the #1 residential pain
9. Pre-con docs (`plans`, `project-files`)
10. Daily ops (`daily-report`, `photo-annotator`, `photo-triage`, `time-tracking`) — A7 intervention
11. Weekly digest (`homeowner-weekly-digest` fn → `client-update`)
12. Stone upgrade CO (`client-messages` → `change-order`)
13. Progress invoice (`bill-from-estimate` → `create-payment-link` fn → Stripe → `stripe-webhook` fn) — A7 intervention
14. Punch (`punch-walk`, `ai-punch`, `punch-list`)
15. Warranty + handover (`warranty-walk`, `warranties`, `handover`, `closeout-binder`)

- [ ] **Step 2: For each step, run this read-then-assess loop**

For step N:
1. Read every screen file and edge function listed in the spec for that step.
2. Read the relevant context (`contexts/ProjectContext.tsx` for project data, `contexts/AuthContext.tsx` for auth, etc.).
3. If the step writes to Supabase, verify it goes through `utils/offlineQueue.ts` (per CLAUDE.md: "Don't call `supabase.from(...).insert/update/delete` directly").
4. Run the 9 evaluable assertions:
   - **A1 data continuity:** does the upstream artifact's data carry forward into this step's screen state without re-typing?
   - **A2 bidirectional:** if the user changes data here, does the change propagate to derived/dependent artifacts?
   - **A3 persona visibility:** does the screen filter by current user's role / portal scope correctly? (Read RLS policies if applicable.)
   - **A4 schedule integration:** does this step write to or annotate the schedule when the spec says it should?
   - **A5 notification routing:** does the right edge function fire (`notify`, `homeowner-weekly-digest`, etc.) with the right recipient targeting?
   - **A6 mobile parity (predict-only):** does this screen use any web-only components or desktop-only navigation? If yes, predict failure for hardware verification.
   - **A7 offline (predict-only at non-intervention steps; predict at intervention steps):** does the step's writes go through `utils/offlineQueue.ts`? If a write bypasses the queue, predict failure.
   - **A8 audit trail:** does the screen surface a per-record history view, or at least the `updated_at` / `updated_by` for the artifact?
   - **A9 permission isolation:** would a wrong-role user be blocked? Check tier gates in `hooks/useTierAccess.ts` and RLS.
   - **A10 revision integrity:** if the upstream artifact is edited (e.g. estimate revised), do this step's references break or revalidate?

5. For each assertion that fails or is ambiguous, file a finding using the template at the top of this plan. Assign the next AUD-### ID.

6. Append a per-step result line to audit doc §2.1:
   ```
   Step N: [PASS] | [FAIL] A1, A2 → AUD-007, AUD-008 | [N/A: hardware] A6 → see runbook §X
   ```

7. Don't commit yet — commit at end of task.

- [ ] **Step 3: Special focus on step 8 (Selections — the #1 residential pain)**

Spend extra attention here because the research flagged it as the most-broken workflow across competitor apps:
- Read `app/selections.tsx` fully.
- Trace: does picking a finish update an Estimate line item AND a budget category AND show in the homeowner's portal AND flow to the next invoice's line items?
- If any of these four flows is missing or broken: this is a **block** finding (A1 + A2 fail on a money-bearing artifact, severity rubric trigger (a)).

- [ ] **Step 4: Special focus on steps 10 + 13 (A7 offline interventions)**

For step 10 and step 13:
- Read `utils/offlineQueue.ts` end-to-end (it's the chokepoint).
- Read each writing screen for the step and confirm it uses `supabaseWrite` helper (or whatever the canonical helper is).
- Read `OfflineSyncManager` (mounted in `app/_layout.tsx`) for reconcile logic.
- Predict: if airplane mode at this step, will reconnect lose data, duplicate, or reconcile cleanly?
- Tag predicted findings `predicted-needs-verification`. The user will confirm in Phase 2 via the runbook.

- [ ] **Step 5: Verify all 15 steps have a result line in audit doc §2.1**

Run: `grep -c "^Step " docs/superpowers/audits/2026-05-07-prelaunch-audit.md`
Expected: at least 15 lines for Path 1 steps.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md
git commit -m "audit: path 1 (residential) headless walk"
```

---

## Task 4: Path 2 walk part 1 — Commercial fit-out steps 1–9

**Goal:** walk steps 1–9 of Path 2 (RFP intake through buyout + sub onboarding) using the same per-step protocol as Task 3. Steps 10–18 are in Task 5 to keep this task bounded.

**Files:**
- Modify: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` §2.2 + §5
- Read: spec §6b path table screens for steps 1–9.

- [ ] **Step 1: Confirm step list from spec §6b**

Steps 1–9:
1. RFP intake (`nearby-rfps`, `my-rfps`, `rfp-detail`)
2. Bid response (`submit-bid-response`, `extract-submittals`, `analyze-spec-book` fn, `estimate-wizard`)
3. Award (`rfp-responses-review`, `award-rfp` fn, `bid-detail`)
4. Prequal + COI (`prequal-form`, `prequal-manager`, `coi-vault`, `coi-expiry-watch` fn)
5. AIA contract (`contract`)
6. SOV creation (`project-detail`, `aia-pay-app` setup) — system-of-record check
7. Project init + Gantt (`project-detail`, `schedule-pro`)
8. Long-lead submittals (`submittal`)
9. Buyout + sub onboarding (`buyout`, `buyout-package`, `sub-portal-setup`, `sub-portals`)

- [ ] **Step 2: Run the read-then-assess loop from Task 3 Step 2 for each step 1–9**

Same 9-assertion evaluation per step. Findings get next AUD-### IDs.

- [ ] **Step 3: Special focus on step 4 (Prequal + COI — federated sub profile)**

Read `app/prequal-form.tsx`, `app/prequal-manager.tsx`, `app/coi-vault.tsx`, `supabase/functions/coi-expiry-watch/`, and the data model for prequal submissions in `types/index.ts`.
- Verify: is a sub's prequal stored at the GC's tenant level (re-uploaded per GC) or at a global sub-profile level (uploaded once, referenced by many GCs)?
- If GC-tenant-only: file a finding tagged `should` or `block` depending on whether the data architecture allows for federation later. Add an explicit recommendation in the finding's notes.
- Verify: COI expiry watch has a 30-day-pre-expiry trigger and emails the sub.

- [ ] **Step 4: Special focus on step 6 (SOV as system-of-record)**

This is the structural keystone for Path 2 — many later steps depend on it.
- Read `app/aia-pay-app.tsx` and `app/project-detail.tsx`.
- Determine: is there a single SOV data structure, with line-item IDs referenced by schedule activities, pay app G703 rows, and CO log entries?
- If schedule activities and pay app rows have separate IDs that aren't linked: **block** finding (A1 + A2 fail on the keystone artifact).
- Cross-reference `docs/workflow-audit-roadmap.md` Tier 1 row "AIA pay app needs StatusPipeline + carry-forward" — if this finding is the same root cause, set `xref` accordingly.

- [ ] **Step 5: Special focus on step 9 (Sub portal scope segregation — A3 cross-persona leakage)**

Read `app/sub-portal-setup.tsx`, `app/sub-portals.tsx`, the marketing site's sub portal route if relevant, and the RLS policy for sub-facing tables.
- Verify: a sub assigned to scope X cannot see scope Y, even if both are in the same project.
- Verify: a sub cannot see other subs' invoices, RFIs, or payment status.
- Any leakage = **block** finding (severity rubric trigger (d)).

- [ ] **Step 6: Append per-step result lines for steps 1–9 to audit doc §2.2**

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md
git commit -m "audit: path 2 (commercial) headless walk pt 1"
```

---

## Task 5: Path 2 walk part 2 — Commercial fit-out steps 10–18

**Goal:** walk the remaining 9 steps of Path 2 (full submittal flow through closeout). This is where the AIA pay app, lien waiver gating, and OAC meeting get audited — the densest commercial workflows.

**Files:**
- Modify: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` §2.2 + §5
- Read: spec §6b path table screens for steps 10–18.

- [ ] **Step 1: Confirm step list from spec §6b**

Steps 10–18:
10. Submittals full (`submittal`) — 6-status workflow, schedule-blocking
11. RFIs (`rfi`) — A7 intervention
12. Daily ops + scheduling (`daily-report`, `schedule-pro`)
13. OAC meeting (`oac-meeting`) — 9-item agenda
14. Change orders (`change-order`) — additive, RFI ↔ CO link
15. AIA pay app (`aia-pay-app`, `lien-waivers`, `retention`) — A7 intervention
16. Job costing & cash (`job-costing`, `cash-flow`, `payment-predictions`)
17. Substantial completion (`punch-walk`, `punch-list`)
18. Closeout (`closeout-binder`, `handover`, `warranties`, `lien-waivers`)

- [ ] **Step 2: Run the read-then-assess loop for each step 10–18**

Same protocol as Task 3 Step 2.

- [ ] **Step 3: Special focus on step 10 (Submittal full workflow + schedule blocking)**

Read `app/submittal.tsx`, `app/extract-submittals.tsx`, and the data model.
- Verify the 6 statuses exist: Submitted, GC Review, Sent to A/E, "No Exceptions Taken", "Make Corrections Noted", "Revise & Resubmit", "Rejected".
- Verify: a submittal's status mutates the dependent schedule activity's gating (e.g. blocks "Install HVAC" if HVAC submittal is still in review).
- If statuses are simpler (e.g. just open/closed): `should` finding.
- If schedule blocking is missing: **block** finding (A4 fail on critical-path artifact + matches competitor complaint #10 in spec §7).

- [ ] **Step 4: Special focus on step 11 (RFI 5-day SLA + RFI ↔ CO link)**

Read `app/rfi.tsx` and `app/change-order.tsx`.
- Verify: RFI has a response-deadline field tracked at 5 working days from issue.
- Verify: an RFI can convert to or link to a CO with the lineage preserved.
- If RFI and CO are isolated tables with no link: **should** finding (matches competitor complaint #4 from research).
- A7 intervention prediction: trace `app/rfi.tsx` write path through `utils/offlineQueue.ts`.

- [ ] **Step 5: Special focus on step 13 (OAC meeting auto-aggregation)**

Read `app/oac-meeting.tsx`.
- Verify: agenda auto-pulls open RFIs, submittal status, CO log, schedule slip, action items. (See spec §6b step 13 for the 9-item agenda list.)
- If it's just a freeform notes screen: `should` finding (A1 fail — data doesn't carry forward from related logs).
- Cross-reference `docs/workflow-audit-roadmap.md` Tier 1 row "OAC meetings StatusPipeline + agenda carry-forward".

- [ ] **Step 6: Special focus on step 14 (Change orders — additive, not destructive)**

Read `app/change-order.tsx`.
- Verify: editing CO #5 does NOT recalculate or invalidate COs #1–4. CO math is additive.
- If CO edits cascade destructively: **block** finding (A10 fail on money-bearing artifact + matches competitor complaint #2 from research).

- [ ] **Step 7: Special focus on step 15 (AIA pay app — lien waiver gating + A7 intervention)**

Read `app/aia-pay-app.tsx`, `app/lien-waivers.tsx`, `app/retention.tsx`.
- Verify: pay app submission UI shows "waivers received: X/Y" and BLOCKS submission until conditional waivers from all billing subs are received.
- Verify: G703 line items derive from SOV (cross-reference Task 4 step 4 finding if relevant).
- Verify: prior pay app continuity preserved (current period's "previous applications" column matches actual prior totals).
- A7 intervention prediction: pay app submission write path goes through `utils/offlineQueue.ts`.

- [ ] **Step 8: Special focus on step 18 (Closeout binder completeness)**

Read `app/closeout-binder.tsx`.
- Verify the binder pulls submittals, RFIs, COs, unconditional final waivers, warranties, final pay app, O&M manuals, as-builts.
- Missing items = `should` findings unless the missing item is unconditional final waivers (then **block** — legal/contract requirement).

- [ ] **Step 9: Append per-step result lines for steps 10–18 to audit doc §2.2**

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md
git commit -m "audit: path 2 (commercial) headless walk pt 2"
```

---

## Task 6: Path 3 walk — Internal GC operations (cross-project office side)

**Goal:** walk all 15 steps of Path 3 from spec §6c, focused on portfolio-level rollups and cross-project consistency. Findings here are often subtle (e.g. dashboard sums don't match per-project totals).

**Files:**
- Modify: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` §2.3 + §5
- Read: spec §6c path table screens.

- [ ] **Step 1: Confirm step list from spec §6c (15 steps)**

1. Bid pipeline (`mage-id-bids`, `leads`)
2. Portfolio budget (`budget-dashboard`)
3. Job costing rollup (`job-costing`)
4. Cash flow forecast (`cash-flow`, `payment-predictions`)
5. Buyout pipeline (`buyout`)
6. Sub management (`sub-portals`, `prequal-manager`, `coi-vault`)
7. Time (`time-tracking`) — A7 intervention
8. 1099 / tax (`tax-1099-export`)
9. Reports (`reports`, `report-inbox`, `data-export`, `weekly-snapshot`) — A7 intervention
10. Notifications (`notifications-inbox`, `morning-digest` fn, `daily-digest` fn, `notifications-settings`)
11. Equipment (`equipment`, `equipment-detail`)
12. Marketplace (`marketplace`, `discover`, `post-job`)
13. Integrations (`integrations`, `payments-setup`)
14. Audit trail (cross-app)
15. Account hygiene (`delete-account` fn, `paywall`)

- [ ] **Step 2: Run the read-then-assess loop for each step 1–15**

Same protocol. Findings get next AUD-### IDs.

- [ ] **Step 3: Special focus on step 6 (Sub management — federated profile + COI expiry)**

Cross-reference Task 4 Step 3 finding (if any). Verify the COI expiry dashboard exists at the portfolio level (not just per-project).

- [ ] **Step 4: Special focus on step 9 (Data export viability)**

Read `app/data-export.tsx` and any export edge functions.
- Verify: export includes audit trail, attachments, linked artifacts (not just a flat CSV).
- If export is flat-only: `should` finding (matches competitor complaint #15 from research — `data export non-viable`).

- [ ] **Step 5: Special focus on step 10 (Notification granularity + quiet hours)**

Read `app/notifications-settings.tsx`, `supabase/functions/notify/`, `morning-digest`, `daily-digest`.
- Verify: per-project, per-role, per-type controls; quiet hours respected; not just a master on/off.
- If granularity is missing: `should` finding (matches competitor complaint #3 + #20 from research).

- [ ] **Step 6: Special focus on step 13 (Bidirectional accounting sync)**

Read `app/integrations.tsx`.
- Verify: if QuickBooks or another accounting system is integrated, invoices post both ways without re-keying.
- If integration is one-way only or missing: `should` finding (matches competitor complaint #17).

- [ ] **Step 7: Special focus on step 14 (Audit trail visibility)**

Cross-cutting — verify a per-record history view exists for at least the money-bearing artifacts (Estimate, Contract, SOV, CO, Pay App, Invoice, Lien Waiver). If `updated_at` columns exist but there's no UI to see history: `should` finding.

- [ ] **Step 8: Special focus on step 15 (Account hygiene — tier downgrade revokes access correctly)**

Read `supabase/functions/delete-account/`, `app/paywall.tsx`, `hooks/useTierAccess.ts`, `supabase/functions/_shared/auth.ts`.
- Verify: tier downgrade immediately revokes feature access (don't allow a former Pro user to keep using Pro features after downgrade).
- Verify: account deletion fully wipes per Apple Guideline 5.1.1(v) (already shipped per recent commit `1b6a5e5`).
- Verify: `OWNER_EMAILS` (client) and `MASTER_EMAILS` (server) are in sync (per CLAUDE.md warning).

- [ ] **Step 9: Append per-step result lines for steps 1–15 to audit doc §2.3**

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md
git commit -m "audit: path 3 (office) headless walk"
```

---

## Task 7: Competitor table-stakes checklist pass

**Goal:** populate audit doc §4 with the 30-item competitor checklist from spec §7, marking each green/yellow/red against MAGE ID. Items already covered by path findings get cross-referenced; uncovered items get fresh investigation.

**Files:**
- Modify: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` §4 + §5
- Read: spec §7 for the full 30-item list.

- [ ] **Step 1: Copy the 30-item table from spec §7 into audit doc §4**

Add a `MAGE ID status` column (green/yellow/red) and a `notes / xref` column.

- [ ] **Step 2: For each item, mark status**

For each of the 30 items:
1. **Check existing path findings.** If the complaint is already addressed by a finding from Tasks 3–6, mark `red` if the finding is `block`, `yellow` if `should`, `green` if `defer` or no finding fired. Add `xref: AUD-###` in notes.
2. **If not covered by a path finding,** do a quick targeted investigation:
   - Read the most relevant screen / context / setting.
   - Verify the feature exists, is wired, and is non-broken.
   - If it doesn't exist or is broken: file a fresh finding with `source: competitor-check`, link it back to the table.
3. **Mark the status:**
   - **green** — feature exists, is correctly wired, and matches or exceeds competitor expectation.
   - **yellow** — feature exists but has gaps; add a finding (severity per rubric).
   - **red** — feature is missing or fundamentally broken; **block** finding required.

- [ ] **Step 3: Specific high-value items to investigate carefully**

These are the universal complaints (5+ apps cited, marked **U** in spec §7). For each, do a targeted code read even if path findings appear to cover it:

- **#1 Mobile parity (U):** check that primary field workflows have iOS-app implementations (daily report, photo, RFI, submittal, punch, time tracking). Already covered by A6 across path walks; consolidate.
- **#2 Offline sync (U):** consolidate findings from A7 interventions (Tasks 3–6) and `utils/offlineQueue.ts` review.
- **#3 Notification noise (U):** cross-reference Task 6 step 5 finding.
- **#5 Per-field permissions (U):** check `hooks/useTierAccess.ts` and any RLS policies; if access is role-based but not field-level, that's a `should` (not block) since per-field is rare even in commercial apps.
- **#6 Estimate → invoice flow (U):** consolidate findings from Path 1 step 5 and Path 2 step 6.
- **#8 Client portal adoption (U):** read `app/client-view.tsx`, `app/client-update.tsx`, marketing portal pages. Verify the portal is professional-looking, accessible without app install, and has email-fallback notifications.
- **#9 New project onboarding (U):** read `app/onboarding.tsx`, `app/dev-seeder.tsx` (for templates). Verify a new project can be set up in under 10 minutes by a competent user.
- **#10 Schedule disconnected (U):** consolidate Path 2 step 10 (submittal blocking) + step 11 (RFI on schedule) + step 14 (CO updates schedule) findings.

- [ ] **Step 4: Verify the table is complete**

Run: `grep -c "^| [0-9]\+ " docs/superpowers/audits/2026-05-07-prelaunch-audit.md`
Expected: 30 lines for the competitor table.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md
git commit -m "audit: competitor table-stakes checklist"
```

---

## Task 8: Hardware verification runbook

**Goal:** populate audit doc §6 with a step-by-step runbook for the user (you, Omir) to execute on the iOS production OTA build. This is the only artifact in this plan that the user will execute directly; everything else is Claude's headless work.

**Files:**
- Modify: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` §6
- Reference: spec §8 (Phase 2) for runbook scope.

- [ ] **Step 1: Pre-flight checklist for the user**

Write into §6:

```markdown
### Pre-flight (do before starting hardware verification)

1. Build a fresh OTA bundle on the production EAS profile so the audit reflects the App Store bits, not dev:
   ```bash
   eas update --branch production --message "audit: hardware verification build"
   ```
2. On both iPhones, force-update the app to pull the new bundle (close and reopen).
3. Use `app/dev-seeder.tsx` to seed three test orgs:
   - Residential GC + homeowner persona
   - Commercial GC + owner-rep + sub persona
   - Internal GC for portfolio testing (Paths 1+2 must be partially advanced)
4. Two iPhones on hand: GC persona + client/sub persona. Plus desktop browser tab.
5. Open the audit doc on a third screen to log results inline.
```

- [ ] **Step 2: Compile the A6 mobile-parity spot-check list**

For every `predicted-needs-verification` finding tagged with A6, list the exact screen + action the user should perform on iOS to confirm or refute. Format:

```markdown
### A6 mobile-parity spot-checks

| Finding | Screen | Action | Pass criteria | Result |
|---|---|---|---|---|
| AUD-### | path | tap-by-tap action | what should happen | (filled by user) |
```

Walk every A6-tagged finding from Tasks 3–6 and add a row. Expected: ~5–15 rows depending on how many A6 findings fired.

- [ ] **Step 3: Compile the 6 A7 airplane-mode interventions**

Per spec §8, the 6 designated interventions:

```markdown
### A7 airplane-mode interventions

For each: (1) put iPhone in airplane mode, (2) perform the action, (3) confirm app shows "queued/pending" state, (4) re-enable network, (5) verify clean reconcile.

| # | Path/Step | Action | Pass criteria |
|---|---|---|---|
| 1 | P1/10 | Submit a daily report with 5 photos | All 5 photos upload on reconnect; report appears once (not duplicated); homeowner digest fires |
| 2 | P1/13 | Create a progress invoice | Invoice persists locally; uploads on reconnect; payment link generates after sync; no duplicate invoice |
| 3 | P2/11 | Submit an RFI | RFI persists locally; uploads on reconnect; A/E recipient is notified once |
| 4 | P2/15 | Submit an AIA pay app | Pay app persists; on reconnect submits to owner; lien-waiver gate respected (blocked if waivers missing) |
| 5 | P3/7 | Enter time-tracking for a crew | Hours persist locally; flow to job costing on reconnect; no duplicate time entries |
| 6 | P3/9 | Request a data export | Request queues; export generates on reconnect; download link delivered |
```

- [ ] **Step 4: Compile the additional hardware-only checks**

```markdown
### Other hardware-only checks

| Check | Screen | Pass criteria |
|---|---|---|
| Push notification arrival | trigger any `notify` fn invocation | Notification arrives on lock screen within 30s |
| Stripe IAP / subscription purchase | `app/paywall.tsx` | Sandbox purchase completes; entitlement reflects in `useTierAccess` immediately |
| Biometric auth (Face ID) | wherever `expo-local-authentication` is used | Prompts correctly; failure falls back to passcode |
| Camera permission flow | `photo-annotator`, `photo-triage`, `daily-report` | First-tap prompts permission; denial is gracefully handled (no crash) |
| Deep link | `rork-app://...` | Test link from email/SMS opens correct screen |
| Haptics | any haptic-firing button | Felt on device, not silent |
```

- [ ] **Step 5: Add a "after hardware verification" checklist for the user**

```markdown
### After hardware verification

For each finding the user worked on:
1. If the predicted finding was confirmed: change status to `confirmed-headless` (the headless prediction was right).
2. If the predicted finding was refuted (works fine on hardware): mark the finding `status: refuted` and remove from the punch list active count.
3. If a NEW finding emerged that headless analysis missed: add it with `source: hardware-only-pending → confirmed-on-device`, severity per rubric.

Then ping Claude to run the final triage pass (Task 9 may need a second iteration after hardware results come in).
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md
git commit -m "audit: hardware verification runbook"
```

---

## Task 9: Triage + filter views (Phase 3 prep)

**Goal:** apply the severity rubric (spec §4) to every finding, tag scope and delivery, generate the three filter views (block / should ≤ M / defer), and cross-reference findings to `docs/workflow-audit-roadmap.md`. This produces the actionable punch list.

This task is "draft triage" — runs before user finishes Phase 2. After hardware verification, a second triage iteration may be needed if findings change.

**Files:**
- Modify: `docs/superpowers/audits/2026-05-07-prelaunch-audit.md` §5 + §7
- Read: `docs/workflow-audit-roadmap.md` for cross-referencing.

- [ ] **Step 1: Verify every finding has all required schema fields**

Go through audit doc §5 finding-by-finding. For each AUD-###, verify these fields are present and non-empty:
- severity
- source
- step (or empty if domain-trace / competitor-check)
- assertions
- personas
- expected
- actual
- repro
- screens / files
- scope
- delivery
- xref (or empty)
- status

If any field is missing on any finding, fill it in (or flag as `unable to determine without hardware` for status only).

- [ ] **Step 2: Apply severity rubric (spec §4) consistently**

For each finding, re-check severity against the rubric:
- **block** triggers (any of):
  - (a) A1/A2/A8 fail on money- or contract-bearing artifact
  - (b) A6 fail on primary field workflow (daily report, photo, RFI, submittal, punch, time tracking, payment)
  - (c) crash / empty-non-functional screen on primary-persona route
  - (d) A3 cross-persona leakage
- **should** triggers: A3/A4/A5/A9/A10 partial fails; A6 on secondary admin; competitor week-1-friction
- **defer** triggers: A7 edge cases that don't lose data; rare A10 paths; polish; A6 on portfolio/admin desktop-only

If a finding's severity doesn't match the rubric, change it. Comment briefly in the finding's notes if the choice was non-obvious.

- [ ] **Step 3: Tag scope and delivery for every finding**

- **scope:** S (<1 day), M (1–3 days), L (>3 days). Estimate based on the screens/files affected.
- **delivery:** OTA (JS-only) or `needs-new-build` (touches `expo.version` boundary, native modules, app.json plugins, or iOS permission strings). Per CLAUDE.md, OTA cannot cross the `expo.version` boundary.

- [ ] **Step 4: Cross-reference to docs/workflow-audit-roadmap.md**

Read `docs/workflow-audit-roadmap.md`. For each finding, check whether the underlying issue maps to an existing roadmap item (Tier 1 row, universal pattern phase, multi-party gap). If yes, set `xref` to the roadmap item title. If a finding surfaces a NEW roadmap item not yet captured, note it in audit doc §7 for the user to add to the roadmap.

- [ ] **Step 5: Generate the three filter views in audit doc §7**

```markdown
### 7.1 Blocks the store (severity = block)

| AUD-### | severity | scope | delivery | title | xref |
|---|---|---|---|---|---|
... (one row per block finding, sorted by AUD-###)

### 7.2 First post-launch sprint (severity = should AND scope ≤ M)

| AUD-### | severity | scope | delivery | title | xref |
|---|---|---|---|---|---|
... (one row per qualifying finding)

### 7.3 Defer (everything else)

| AUD-### | severity | scope | delivery | title | xref |
|---|---|---|---|---|---|
... (one row per qualifying finding)
```

- [ ] **Step 6: Add a triage summary at the top of §5**

```markdown
**Triage summary (as of <date>, headless pass complete; hardware pass pending):**
- Total findings: N
- Blocks the store: X (must fix before App Store submission)
- First post-launch sprint: Y (should fix in first 2 weeks post-launch)
- Defer: Z
- Hardware-pending: W (subset of above; final severity may shift after Phase 2)
```

- [ ] **Step 7: Update audit doc status from `in progress` to `headless pass complete; awaiting hardware verification`**

Edit the header at the top of the audit doc.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/audits/2026-05-07-prelaunch-audit.md
git commit -m "audit: draft triage and filter views (headless pass complete)"
```

---

## After all 9 tasks complete

The audit doc is ready for the user to:
1. Read the punch list filter views (§7).
2. Execute the hardware verification runbook (§6) on iOS.
3. Update findings post-hardware: confirm / refute / add new.
4. Run a second triage iteration if hardware findings shifted severities (Claude can do this on request — re-run Task 9 with updated finding set).

After that, the punch list drives the final 2–3 weeks of pre-launch work.

---

## Self-review checklist (run by writing-plans before handoff)

- [x] **Spec coverage:** every section of the spec maps to at least one task. §1 (charter) → Task 1; §3 (deliverables) → Tasks 1, 9; §4 (severity rubric) → Task 9; §5 (assertions) → Tasks 3–6; §6 (paths) → Tasks 3–6; §7 (competitor checklist) → Task 7; §8 phases (1, 2, 3) → Tasks 1–7 (Phase 1), Task 8 + user (Phase 2), Task 9 + user (Phase 3); §9 (roadmap relationship) → Task 9 step 4.
- [x] **Placeholder scan:** no TBD/TODO/"add appropriate ..." present.
- [x] **Type consistency:** finding schema is identical across plan header, all task references, and the audit doc skeleton.
- [x] **Bite-sized steps:** each step is a discrete read/write/commit action, even when the surrounding task is meaty.
