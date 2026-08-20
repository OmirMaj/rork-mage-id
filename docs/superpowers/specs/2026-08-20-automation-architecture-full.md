# Automation-first architecture — the full vision

_2026-08-20. This finishes the vision the first vertical proved. It is the
critique-corrected synthesis of a nine-domain inventory of the real codebase
(81 raw opportunities), an architecture pass, and an adversarial completeness +
honesty critic. Where the first synthesis over-claimed, this doc corrects it in
plain terms — the point of automation here is that **it never lies to a
contractor**, so the architecture doc must not either._

Companion to `2026-08-19-automation-engine-design.md` (the locked interfaces for
vertical #1). That vertical is **shipped and surfaced** (Construction AI →
Roadmap → "Generate inspection schedule"). This doc is the map of everything
that plugs into the same spine.

---

## 1. Thesis

MAGE ID's first vertical is not a feature; it is the **reference implementation
of the whole product**. The pattern:

> An **event** in one feature deterministically proposes **draft work** in
> another, linked by a **provenance-carrying lead-time lag**, and nothing drives
> real work until an **earned-trust gate** passes.

"Once you pour the foundation, call for the DOB inspection — but give it a week,
because the response is slow" is one instance of a general shape. The nine domain
inventories are **not nine roadmaps — they are one engine invoked from nine event
sources.** Finishing the vision means adding **event watchers** (not new engines)
at each domain's existing mutation points, plus honest handling of the outcomes
those events represent.

---

## 2. The shared engine — what is genuinely shared (and what is not)

The critic's most important correction: **the schedule engine is genuinely
reusable; a universal `eventToWork<T>` envelope is not — it is
abstraction-for-symmetry, and building it would fight each domain's natural
idempotency key.** So we are precise about the seam.

### 2a. Shared implementation — for lead-time + gating-task work only

Reuse verbatim; do not reinvent:

- **`utils/automation/eventToScheduleWork.ts`** — pure factory.
  `ScheduleWorkRequest{ kind, gatingTaskId|gatingTaskHint, leadTimeDays, whoActs,
  sourceEventRef, title } → { tasks, unresolved }`. Idempotent on `sourceEventRef`
  via deterministic `auto:<feature>:<id>`. Resolved path patches the gating task
  with an `FS + lagDays` dependency; unresolved path **SNET-anchors so nothing
  silently floats**. `kind` is a free string, so a new event source can fire
  before its library entry lands.
- **`utils/automation/leadTimeLibrary.ts`** — `getLeadTime(kind, jurisdiction?)
  → { days, source, confidence }`. Already seeds `dob_inspection`,
  `permit_review`, `submittal_review` (14d), `rfi_response` (7d), `material_lead`
  — **kinds nobody is calling yet.** `'jurisdiction'` reserved for a real dataset
  hit; `'learned'` reserved for the prediction ledger.
- **`utils/automation/jurisdiction.ts`** — trust-but-verify zoning;
  `zoningConfirmedAt` is the downstream gate.
- **`utils/scheduleEngine.ts`** — CPM (FS/SS/FF/SF + `lagDays`),
  `buildScheduleFromTasks` (recomputes on commit).
- **`components/automation/AutoScheduleReviewSheet.tsx`** — the confirm surface.

**This engine covers everything with a lead-time lag + a gating task:**
inspections (booking *and* result), submittals, RFIs, material POs, sub
pre-mobilization, COI-renewal-before-mobilization, weather reflow, cert renewal,
warranty walks.

### 2b. Shared *principle*, not shared *code* — for non-schedule outcomes

Billing (`utils/billingFlowCore.ts`), leak→CO (`utils/brain/leakCoDraft.ts`), and
any hazard/JHA flow produce a **draft invoice / CO / flag — not a task.** They
already exist and they share the **five invariants** below, but structurally they
share **nothing** with `eventToScheduleWork` — no `sourceEventRef`, no
`unresolved`/SNET, no gating-task/lag model. `leakCoDraft` keys idempotency on an
audit-trail marker that deliberately survives cache wipes; billing keys on
`milestone.invoiceId`. **Each chose a domain-correct key for a reason.** Forcing a
`DraftWork<T>` envelope over them would be a wrapper that fights those keys.

**Decision: keep the schedule engine shared; keep the *principle* shared (below);
do not build `eventToWork<T>`.** New non-schedule factories are pure adapters that
obey the invariants and commit through their own domain mutation.

### 2c. The four extension points (schedule verticals)

Every new schedule vertical is **one watcher + one adapter + one lead-time kind +
one review route** — no new plumbing:

- **(A) Event watcher** — a `useEffect`/`onSuccess` at the domain's existing
  mutation, mirroring the proven `CO → reflow` watcher (`ProjectContext.tsx`
  ~1950–2050) and `DFR → progress`. Fires on the status transition the inventory
  already emits.
- **(B) Adapter** — a pure `<domain>ToScheduleWork.ts` mirroring
  `roadmapToScheduleWork.ts`: map the event → a `ScheduleWorkRequest`, resolve
  `leadTimeDays` via `getLeadTime`, stamp `sourceEventRef`.
- **(C) Lead-time kind** — add one `LeadTimeKind` (`sub_mobilization`,
  `cert_renewal`, `warranty_walk`, …) with a seeded default + **honestly
  calibrated** confidence.
- **(D) Review + commit** — route the draft through `AutoScheduleReviewSheet` (or
  the domain's own review surface for non-schedule drafts), gated per §3, and
  commit via the existing mutation.

---

## 3. The one discipline — never present a guess as truth

Applied identically at every event source. **Where the first synthesis
over-claimed uniform confirm-gating, this version states the truth: there are two
distinct gates, and we name which one each vertical uses.**

1. **Provenance always.** Every derived value (zoning, code ref, lead time,
   arrival date, delay days) returns *with* `{ source, confidence }`. A lead time
   with no provenance must not exist. An LLM-sized value is `source:'ai_estimate'`
   and **must not masquerade as `'jurisdiction'`**; only a real dataset earns
   `'jurisdiction'`, only the ledger earns `'learned'`.
2. **Draft always.** Auto-created work lands `isAutoGenerated` + `sourceEventRef`,
   status `draft`/`not_started`. The factory returns work the caller commits; it
   never persists.
3. **Idempotent always.** Deterministic id (schedule) or a domain dedup marker
   (`leakCoDraft` processed-IDs, CO `scheduleImpactApplied`, `dunningStage`) means
   re-running an event never double-creates.
4. **Never silently float.** Unresolved gating task → SNET anchor + a "pick a
   predecessor" flag. **Correction to land (§7): the current unresolved book-by
   date is `project.start + lead`, which is arithmetically meaningless — show a
   "needs linking" state, not a fabricated calendar date.**
5. **Two honest gates — name them.**
   - **Confirm-gated:** an explicit per-item human confirm before commit
     (inspections via `AutoScheduleReviewSheet`; the CO reflow *preview modal
     when `scheduleImpactDays > 0`*).
   - **Draft-status + earned-trust gated:** commits to state *silently* as a
     `draft` (never sent/actioned), governed by the autonomy ladder
     (`utils/brain/autonomyGate.ts` — per-trade pace `n≥5, rate≥0.60`;
     leak precision `n≥5, billedRate≥0.50`) with a `didForYou` receipt *after* the
     fact. This is the leak→CO sweep and the client-portal CO reflow.
   - **The doc must not call the second one "confirm-gated."** Draft-status is a
     safety net; it is not a confirm. Money-out and schedule-mutation-from-remote
     paths (§7) get upgraded to real confirms.
6. **Hard blocks on missing grounding.** Zoning-not-confirmed blocks
   code/auto-schedule ("confirm zoning to enable", never a guess). Simulated
   weather is refused by the delay log. A low-confidence material lead requires
   explicit GC confirmation before it can gate a real task.

**The uniformity is the product:** a contractor learns the confirm gate once on
inspections and it means the same thing everywhere.

---

## 4. Vertical map (corrected priority)

Tiers reflect the critic's re-prioritization, **not** "already shipped = now."

### Shipped (the proven spine — audit, don't rebuild)
- **Permit roadmap → inspection schedule** (vertical #1). Confirm-gated. ✅
- **Change Order approved → schedule reflow.** Confirm-gated *only when
  `scheduleImpactDays > 0`*; the money-only path and the **client-portal remote
  approve** reflow on the idempotency marker alone — see §7.
- **DFR leak scan → draft CO.** Draft-status + leak-precision gated (not per-item
  confirm). Carry x-ray confidence onto CO line items (gap).

### Wave A — closes the loop on what we shipped (schedule-native, no new data)
1. **Inspection *result* → schedule + safety** *(the missing half — build first)*.
   `PermitStatus 'inspection_passed' | 'inspection_failed'` already exists.
   **Pass → release the gated successor** (the whole reason the lag existed).
   **Fail → draft re-inspection task with lag + push the tasks it gates + spawn a
   Hazard** (the fail→`Hazard` flag already exists in `SafetyContext` /
   `utils/safety/inspectionScore.ts`). Pure schedule-engine work.
2. **Submittal `revise_resubmit` / approved → schedule slip + procurement
   release** *(≈90% wired)*. `SubmittalReviewCycle` carries sent/return/required
   dates; `leadTimeLibrary` already seeds `submittal_review`; the adapter's
   `inspectionKind` already routes the "submittal" keyword. One watcher.
3. **RFI answered → release gated task.** `rfi_response` (7d) already seeded;
   latency `(dateResponded − dateSubmitted)` captured as evidence; ball-in-court
   tunes the default. One watcher.
4. **COI / license expiry → renewal task + mobilization block.** `licenseExpiry` /
   `coiExpiry` exist. Draft "request renewed COI" ahead of the sub's mobilization
   task; **hard-block scheduling that sub past expiry.** Pure date math, high GC
   value.
5. **Sub assigned → pre-mobilization tasks** (site walk, staging, orientation, 7d
   before start). New `sub_mobilization` kind (7d, low).

### Wave B — live-signal (needs the OpenWeather key + a small prefs schema)
6. **Weather delay → schedule reflow.** `ProjectSchedule.weatherDelayLog` is an
   existing *evidence-backed* stream (only written when live weather confirms). A
   logged delay day pushes the affected outdoor tasks, reflowing like the CO
   cascade. **Refuses simulated.**
7. **Weather forecast (live) → crew digest + optional draft DFR stub.** Advisory,
   not task-creation. Needs a crew notification-prefs schema.
8. **Cert expiring → renewal task** (blocked on `CrewMember↔Worker` linkage).
9. **Warranty walk (11-month) → auto-scheduled walk task** (low value, low
   effort; currently banner-only).

### Wave C — money & collections (strictest gates)
10. **Milestone reached → draft *progress invoice*.** `billingFlowCore` already
    computes the amount *with double-bill prevention*. **Propose-only,
    always-confirm — never auto-fire on the autonomy ladder (§5).**
11. **Invoice overdue → portal notice + GC follow-up task.** Dunning cadence
    (`dunningStage`) exists. Confirm before *send*; never auto-send.

### Wave D — external-data-grounded (behind confirm gates, source-honest until real data lands)
12. **Buyout/commitment → material-PO lead-time tasks** (order lumber 14d before
    framing). Blocked on real `SupplierListing.leadTimeDays` — hardcoded 14d/low
    until then.
13. **Selection chosen → material-arrival task** (`SelectionOption.leadTimeDays`
    exists, never wired).
14. **CO adds new scope → re-run roadmap for new inspections** (special
    inspections). Auto-commit *only* if zoning confirmed AND lead is
    jurisdiction/high; else draft.
15. **Zoning confirmed → grounded code requirements.** Blocked on an IRC/IBC code
    dataset; fails gracefully to manual.
16. **Takeoff/job-cost variance → cost-impact ticket.** Blocked on CSI
    classification + a variance-threshold *policy decision* + debounce.

### Learning loop (last)
17. **Prediction ledger → `'learned'` lead times.** Graded outcomes (actual
    material arrival, actual RFI hold, actual submittal cycle, per-trade pace)
    upgrade library defaults to `source:'learned'` after `n ≥ threshold` — the
    cost-learning moat, self-improving every prior vertical with no new UI.

---

## 5. What stays MANUAL (over-reach — do not automate)

The critic's YAGNI/trust findings, adopted as hard scope boundaries:

- **JHA auto-draft (`jha_proposal`).** A Job Hazard Analysis is a legal document a
  competent person authors and signs. Auto-proposing one trains rubber-stamping —
  the opposite of its purpose. The existing failed-inspection → **Hazard flag** is
  the right granularity (a flag, not a signed document). **Drop `jha_proposal`.**
- **Delay → CO (`co_from_delay`).** A delay CO is an *accusation of fault* needing
  judgment and a contract-clause read. The existing leak→CO is grounded in a
  priced line a human wrote; a delay CO is not. **Keep manual.**
- **Nationwide zoning *guess* source.** Leave the `ZoningGuessSource` seam unbuilt
  until grounded parcel data exists. A confident-sounding "R-5" guess anchors the
  contractor's confirmation (anchoring bias). For zoning, a **blank to fill** is
  safer than a guess to refute.
- **Auto-*send* anything** (invoice, owner notice, portal message). Auto-*draft*
  only; a human sends.

---

## 6. Data grounding needs (each upgrades a guess to a fact, behind the gate)

- **AHJ / parcel + zoning API** → populates `JURISDICTION_OVERRIDES`, upgrades
  `resolveZoning` guess→confirmed, unblocks `'jurisdiction'` leads + code
  requirements.
- **Supplier catalog / quote feed** → real `SupplierListing.leadTimeDays` /
  `SelectionOption.leadTimeDays` (exist in types, never sourced).
- **IRC/IBC code dataset (versioned)** → grounds `CodeFinding.codeRef` (today an
  unvalidated LLM output); dataset version is the provenance.
- **AHJ permit/inspection submission + polling APIs** → two-way status sync
  (roadmap is forward-plan only today). Separate integration.
- **Historical closed-job ledger** → the `'learned'` source (the moat).
- **Cost-variance threshold policy** (config, not external) + **crew
  notification-prefs schema** (internal) + **confirmed CSI classification** on
  estimate/takeoff items.

---

## 7. Honesty corrections that MUST land before the thesis is true

These are not optional polish — they are the difference between "never lies to a
contractor" being true and being marketing:

1. **Distinguish the two gates in code and copy.** The client-portal CO reflow and
   the leak→CO sweep are **draft-status + earned-trust gated, not
   confirm-gated.** Either add a confirm on the remote/money-only reflow path, or
   state the distinction honestly wherever we describe the system. A remote client
   approval that reflows a schedule in the background is real mutation without the
   gate the thesis promises.
2. **Carry provenance past commit.** Today a `source:'ai_estimate'` lead becomes an
   anonymous `FS + lagDays` number the moment it commits — the chip's provenance
   lives only at confirm time; a later viewer sees a confident-looking dependency
   built from a 3-day zod-defaulted guess. **Stamp `source`/`confidence` onto the
   persisted `DependencyLink` (or a sidecar)** so the schedule can't launder a
   guess.
3. **Recalibrate `leadTimeLibrary` confidences down.** `permit_review` at `'med'`
   on a zero-jurisdiction national number is overconfident — permit review varies
   from 2 weeks to 6 months by city. National defaults are **`'low'`** until a
   jurisdiction dataset backs them.
4. **Fix the unresolved book-by date** (§3.4): show "needs linking", not a
   fabricated `start + lead` calendar date.

---

## 8. Roadmap

- **Phase 0 — harden the spine.** Audit the 3 shipped verticals *before*
  extending: prove `scheduleImpactApplied` can't race the offline queue
  (double-apply); add a pre-commit factory-idempotency validator; close the
  leak→CO x-ray-provenance gap; land the §7 honesty corrections. _Do not build six
  watchers on an un-audited race._
- **Phase 1 — Wave A** (inspection-result → submittal/RFI → COI-expiry → sub
  pre-mob). Schedule-native, zero new data, closes the loop on the shipped
  vertical. Each is one watcher + one adapter + one kind.
- **Phase 2 — Wave B** (weather reflow + digest, cert, warranty). Live-signal;
  refuse simulated; needs the prefs schema.
- **Phase 3 — Wave C** (milestone→invoice, overdue→notice). Strictest gates;
  always-confirm; never auto-send.
- **Phase 4 — Wave D** (material PO, selection, CO→roadmap-rerun, zoning→code,
  variance). Each blocked on a dataset/policy; last; hard-gated; source-honest;
  upgradeable without touching call sites.
- **Phase 5 — the learning loop.** Wire `predictionLedger` `'learned'` back into
  `leadTimeLibrary`.

---

## 9. Risks (carried forward)

- **Idempotency-marker races under the offline queue** — every new watcher sets
  its marker inside the same optimistic mutation; a pre-commit validator asserts
  re-run idempotency.
- **Provenance laundering** (§7.2) — the single biggest threat; enforce at the
  type/UI boundary that `source` is always displayed and `'jurisdiction'`/
  `'learned'` can only originate from the dataset/ledger.
- **Confirm-gate fatigue** — tier by value; let the autonomy gate
  silence-with-receipt the high-precision drafts and hard-confirm only the
  consequential/low-confidence ones.
- **`eventToWork<T>` regression risk** — avoided by *not building it* (§2b).
- **Blocked verticals shipped on placeholder data** — keep Wave D last,
  hard-gated, labeled "estimated, confirm before it drives work."
- **Fuzzy gating-task resolution** — SNET honesty path + CSI hints; never
  auto-commit an unresolved link.
- **Legal weight of delay events / notices** — advisory draft-only, heavy confirm,
  never auto-send.

---

## 10. Out of scope

AHJ two-way integration, nationwide parcel grounding, and the code dataset are
*grounding upgrades* that slot behind existing confirm gates without changing the
spine. `eventToWork<T>`, `jha_proposal`, `co_from_delay`, and any auto-send are
**dropped**, not deferred.
