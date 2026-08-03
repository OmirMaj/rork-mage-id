# Cryptographic Claim Defense — Design Spec

**Date:** 2026-08-03
**Status:** Design. Not approved, not planned, not built.
**Author:** Claude + founder
**Method:** every code claim below was grepped or queried before it was written. Production DB
(`nteoqhcswappxxjlpvap`) was read directly for migration state, row counts, and RLS policies. Legal
claims carry citations from a dedicated research pass; anything unverified is marked **UNVERIFIED**,
and claims that are commonly asserted but wrong are marked ⚠️. §6.7 is the do-not-say list, and it
includes several things an earlier draft of this document asserted before they were checked.

---

## The pitch, and the part of it that is true

> *"Every weather delay, RFI decision, and field photo is hashed and timestamped. If a developer
> sues for a schedule overrun, MAGE ID auto-generates an unassailable legal ledger proving that the
> owner's scope changes caused the delay."*

Two-thirds of that is buildable now. One word in it is a lie, and this document's most important
section is the one that says so (§6).

**Why this pillar and not another one.** It needs no network effect — the product is pre-launch
(`brain_predictions`: **3 rows**; `comm_events`: **0 rows**; 7 projects, 4 change orders, 1 contract
across 29 auth users, all seed/dev). It is roughly 70% built. And it is the natural continuation of
two days spent deleting false claims from this product: **a ledger is worth exactly nothing if its
inputs were ever fabricated.** The honesty work *is* the claim-defense work. `WeatherDelayLogEntry`
refusing to record a simulated rain day is not a marketing fix — it is the single most legally
valuable line of code written this week.

---

## 1. The legal reality this serves

### 1.1 Notice: the cheapest way to lose a claim you would have won

Most construction contracts make written notice a **condition precedent** to any claim for time or
money. Miss the window and the claim is waived — not weakened, waived — **even when the entitlement
was completely real**.

| Contract | Clause | Window |
|---|---|---|
| AIA A201-2017 | §15.1.3.1 — Notice of Claim | **21 days** from the event or from recognition of the condition, whichever is later |
| AIA A201-2017 | §15.1.3.2 — delivery | Written, by **certified or registered mail, or courier with proof of delivery** (ordinary email does not satisfy this unless §1.6 electronic transmission is set up in the agreement) |
| AIA A201-2017 | §3.7.4 — concealed / unknown conditions | **14 days** — shortened from 21 in the 2007 edition |
| ConsensusDocs 200 | §6.3 / §8.4 notice families | Commonly **14 days**; varies by edition — **UNVERIFIED**, confirm against the specific edition before encoding a default |
| Residential short-form (AIA A105, and most GC-authored agreements) | varies | Frequently **7–14 days**, often with no delivery method specified — **UNVERIFIED** as a general rule |

A201-2017 also closed the loophole a lot of GCs used to rely on: **claims for Contract Time are now
expressly inside §15.1.1**, so a delay claim needs the same formal Notice of Claim as a money claim.

**Is late notice actually fatal?** It depends on the state, and the product must never pretend
otherwise. Courts split:

- **Strict-compliance jurisdictions** treat the notice provision as a condition precedent — late
  notice waives the claim, full stop, regardless of whether the owner knew.
- **Other jurisdictions** excuse late notice where the owner had **actual notice** and cannot show
  **prejudice**, or find **waiver by conduct** (the owner negotiated the claim on the merits without
  objecting to timeliness), or apply **substantial compliance**.

The product's job is to make the deadline *impossible to miss*, not to opine on what happens if it
is. See §6.7 for the exact language limit.

**Missing notice can cost you the claim even when the owner caused the delay — and you can still owe
liquidated damages on top.** This is the fact that justifies the whole feature:

> ***Greg Opinski Construction, Inc. v. City of Oakdale*, 199 Cal.App.4th 1107 (2011)** — contractor
> held liable for LDs **despite owner-caused delay**: *"since the contractor did not use either of
> the available contract procedures to obtain a change order to extend the contract time, **the time
> was not extended, regardless of which party was to blame** for the late completion."* Accord
> *Dugan & Meyers Constr. Co. v. Ohio Dept. of Admin. Servs.*, 113 Ohio St.3d 226 (2007).

Excusability is necessary but not sufficient. **The extension has to actually be obtained through
the contract's machinery.** That makes the notice clock (§3) load-bearing twice over.

### 1.2 What a GC must actually be able to produce

⚠️ **"Entitlement / causation / quantum" is consultant vocabulary, not a judicial formula.** It is a
useful way to organize a product and this spec uses it as such — but courts say **liability,
causation, and resultant injury**, and a document that attributes the consultant framing to a court
is doing the exact thing this product just spent two days stopping.

> ***Wilner v. United States*, 24 F.3d 1397, 1404 (Fed. Cir. 1994) (en banc)** — *"when the claim
> being asserted by the contractor is based upon alleged government-caused delay, the contractor has
> the burden of proving **the extent of the delay, that the delay was proximately caused by
> government action, and that the delay harmed the contractor**."* Accord *William F. Klingensmith,
> Inc. v. United States*, 731 F.2d 805, 809 (Fed. Cir. 1984).

| Element (product framing) | Judicial framing | What proves it |
|---|---|---|
| **Entitlement** | liability | The contract clause, the causal event, and **timely notice**. This is where most small GCs die — not on the facts. |
| **Causation** | proximate cause | Critical-path delay. A delay to an activity with float delays nothing. Requires an as-planned baseline and as-built actuals. |
| **Damages / quantum** | resultant injury | Job-cost records with a separate code, extended general conditions, equipment standby. Cannot rest on speculation. |

★ **`Wilner`'s other holding constrains the UI directly.** It overruled the rule that a contracting
officer's decision is an evidentiary admission — *"the parties start in court or before the board
with a clean slate."* **An owner granting time extensions is not an admission that the owner caused
the delay or owes money.** No screen may imply that granted extensions equal conceded liability.
(*Wright Brothers*, ASBCA 62285: the CO had already granted **986 days** of extensions and the
contractor still lost its ~$455K claim for failing to tie the delays to the critical path.)

### 1.3 The classification that decides whether you get money or only time

| Type | Time? | Money? |
|---|---|---|
| **Excusable + compensable** — caused solely by the owner (scope change, late RFI answer, owner-supplied item, differing site condition the owner bears) | Yes | Yes |
| **Excusable, non-compensable** — force majeure, unusually severe weather, third-party events | Yes | No |
| **Non-excusable** — the contractor's own scheduling, manpower, coordination | No | No |

**Concurrent delay is the owner's best defense and the product must model it.** When an owner-caused
delay and a contractor-caused delay overlap in the same period, the general US rule converts an
excusable-compensable delay into **excusable but non-compensable** — the GC gets the time, not the
money. A claim register that cannot represent "the owner delayed me here, and I was also late on my
own framing here" will produce a packet that opposing counsel dismantles in one question.

### 1.4 How the delay itself gets proven

AACE International **Recommended Practice 29R-03, "Forensic Schedule Analysis"** is the reference
taxonomy. It sorts CPM-based methods on two axes — **observational vs. modeled**, and **static vs.
dynamic** — into nine method implementation protocols (MIP 3.1–3.9).

- **Observational** — examine the schedules as they existed; the analyst does not alter the network.
  *As-planned vs. as-built* is the simplest form.
- **Modeled** — insert delays into (impacted as-planned) or extract them from (collapsed as-built /
  "but-for") the CPM network and compare before/after.

| Method | Realistic for a small GC? | Evidentiary weakness |
|---|---|---|
| **As-planned vs. as-built** | **Yes — this is the one.** Needs a baseline and actuals, nothing else. | Purely observational: it shows *that* dates moved, not *why*. Weak on causation and blind to concurrency unless narrated event by event. |
| **Impacted as-planned** | Possible — `runCpm()` is pure and can be re-run on a mutated task array | Ignores what actually happened; criticized as theoretical. |
| **Collapsed as-built (but-for)** | Possible, harder | Requires a defensible as-built network; subjective in how delays are extracted. |
| **Time impact analysis / windows** | **No.** Needs a contemporaneously updated, statused CPM and usually a consultant. | The most respected, and the most expensive. |

★ **The CPM requirement is conditional, and this is the best single legal fact supporting this
product's existence.**

> ***Alares Construction, Inc. v. Dep't of Veterans Affairs*, CBCA 6149 (Mar. 21, 2025)** — a
> contractor *"**generally** must identify the critical path … which is **typically** done through …
> a CPM schedule analysis"*, **but** *"**When a contract requires the use of CPM scheduling during
> contract performance**, … the contractor **must** use CPM schedule analysis to support a claim."*
> Accord *Hoffman Constr. Co. v. United States*, 40 Fed. Cl. 184, 197–98 (1998).
>
> ***Howard Contracting, Inc. v. G.A. MacDonald Constr. Co.*, 71 Cal.App.4th 38 (1999)** carries an
> actual section heading: **"Critical Path Method Schedule Is Not Required To Prove A Delay Damages
> Claim."** The contractor proved critical-path delay **on a bar chart**.

**A105/A104, ConsensusDocs, and essentially every custom residential agreement do not require CPM
scheduling.** MAGE's users are structurally in the "not required" lane — which is precisely the lane
where a well-kept contemporaneous record beats a schedule analysis nobody can afford. The counter-
weight, stated honestly: the CBCA still calls CPM *"so entrenched in the construction industry as to
be a de facto analytical requirement,"* and *Rustler Construction, Inc. v. District of Columbia*,
211 A.3d 187 (D.C. 2019) allows non-CPM proof through expert testimony but **still ruled against the
contractor** because its VP *"did not have a background in engineering, did not consult with anyone
who had a background in scheduling."*

**AACE licenses the proportionate approach explicitly.** 29R-03 §5.4 (Size of the Dispute): if the
delay damages *"are approximately **US$100,000**, then the forensic schedule analyst should recommend
**a relatively inexpensive** forensic scheduling method,"* with a separate **Factor 6: Budget**
advising *"less expensive forensic scheduling methods or cost saving alternatives."* A published
recommended practice authorizes exactly the tier of rigor this product can deliver.

**Design consequence:** MAGE targets **as-planned vs. as-built, narrated by a chronological delay
register**, and treats the modeled methods as an expert's job. The narration is the product. Anyone
can export two Gantt charts; almost no small GC can produce a dated, evidenced, notice-tracked story
of *why* the second one differs from the first.

**And the honest ceiling, which belongs in the spec and in §6.7:** this tool helps prove **what
happened and when**. It does not prove **criticality**. AACE concedes that without schedule updates
or a logic-linked baseline, objectively identifying controlling activities is *"difficult, if not
impossible,"* and that as-built accuracy is *"never going to be perfect."* *Costain v. Haswell*
[2009] EWHC 3140 (TCC) is the cautionary tale: both experts **agreed** the works were on the critical
path and the prolongation claim **still failed** — *"no evidence has been called to establish that
the delaying events in question in fact caused delay to any activities on site … the prolongation
claim … fails for want of proof."* (UK, persuasive only, but the reasoning transfers.)

### 1.5 Contemporaneity is the property that matters

A record made **at or near the time** of the event, in the ordinary course of business, is worth
enormously more than a reconstruction assembled after the dispute started. That is not a stylistic
preference — it is the hinge of the business-records hearsay exception, **FRE 803(6)**, which
requires the record be *made at or near the time by — or from information transmitted by — someone
with knowledge*, *kept in the course of a regularly conducted activity* **(B)**, and that making it
was a *regular practice* **(C)**.

> ***Palmer v. Hoffman*, 318 U.S. 109, 113–114 (1943)** — *"**Unlike payrolls, accounts receivable,
> accounts payable, bills of lading and the like, these reports are calculated for use essentially
> in the court, not in the business. Their primary utility is in litigating, not in railroading.**"*
>
> ***CTA I, LLC v. Dep't of Veterans Affairs*, CBCA 5826 (Mar. 22, 2022)** — *"**There is, to be
> sure, a heavy presumption that regularly updated, contemporaneous schedules are the best evidence
> of project progress.**"* … and on a retrospective expert reconstruction, *"the natural suspicion
> that activities may have ended up on the expert's critical path only because CTA said in hindsight
> they were critical."*

The routine daily log sits on the payroll side of *Palmer*. A narrative "delay memorandum" drafted
by a claims consultant after the dispute starts sits on the accident-report side.

★ **Two corrections to conventional wisdom that change what the product should optimize:**

1. **"Self-serving" is not a ground for exclusion.** The Advisory Committee is explicit: *"absence
   of motivation to misrepresent has not traditionally been a requirement of the rule; that records
   might be self-serving has not been a ground for exclusion."* A contractor's own log is not
   excluded for being the contractor's. **Routineness — 803(6)(C) — is where daily reports actually
   die.** A superintendent who logs only on eventful days satisfies (B) and **fails (C)**.
   *Meltech Corp.*, ASBCA No. 61765, lost on exactly this: the PM *"did not 'make[] a habit of
   noting'"* problems, and the board gave the later testimony *"little credence."*
2. **Therefore the metric that matters is daily-completion rate, not report quality** — including
   "nothing happened" days. That is a streak/nudge feature with a direct evidentiary justification,
   which is a rare thing to be able to say.

And the record-rewriting failure mode, which validates §6.2's "additive, never overwrite" rule:

> ***Vistas Construction of Illinois, Inc.*, ASBCA Nos. 58479–58488 (Jan. 12, 2016)** — contractor
> annotated daily reports years later while preparing a $17M+ REA. *"Vistas **did not merely add
> notations to 'assist' the Corps; it essentially re-wrote these documents**…"* … *"**It seems
> rather odd to us that Vistas would have spent the time to rewrite multiple volumes of certified
> payrolls and daily reports if it had contemporaneous records that proved its case.**"* … *"**this
> has seriously undermined the credibility of Vistas' witnesses.**"*

The mechanic that converted sloppiness into catastrophe: the form required the contractor to
*"certify that this Report is complete and correct."* **If MAGE ever has users certify a daily
report, the certification must be immutable and server-timestamped, and later edits must be additive
and visibly dated — never overwrites.**

Two self-authentication rules matter for a system like this:

- **FRE 902(13)** — "A record generated by an electronic process or system that produces an accurate
  result, as shown by a certification of a qualified person…"
- **FRE 902(14)** — "Data copied from an electronic device, storage medium, or file, if authenticated
  by a **process of digital identification**, as shown by a certification of a qualified person…"
  The Advisory Committee notes explain that **identical hash values between an original and a copy
  reliably demonstrate that they are exact duplicates.**

Both require a **certification by a qualified person** meeting Rule 902(11)'s requirements, **and
advance notice to the opposing party**. Read that carefully, because it defines the ceiling on what
hashing buys:

> **902(14) authenticates a copy against an original. It says nothing about when the underlying
> event happened, and nothing about whether the content is true.**

MAGE's hashes can support "these bytes are the bytes that were sealed." They cannot, by themselves,
support "the rain fell on the 14th" or "the owner directed this change."

---

## 2. The unifying data model

### 2.1 Six primitives, zero edges

Everything below exists and works. **None of them reference each other.** There is no object in this
codebase that says "this photo, this weather day, this RFI, and this CO are the same delay."

| Primitive | Where | Status |
|---|---|---|
| `WeatherDelayLogEntry` | `types/index.ts:754-784`, on `ProjectSchedule.weatherDelayLog` (`:824`) | Required `source: 'live' \| 'mixed'`, **no `'simulated'` member**; `dates[]` documented as "the evidence list — never contains a simulated date." `buildWeatherDelayLog()` (`utils/weatherReschedule.ts:286`) returns `null` rather than write an unevidenced entry. |
| `COAuditEntry` | `types/index.ts:1150-1156`, on `ChangeOrder.auditTrail` (`:1189`) and `FieldTicket.auditTrail` (`:4555`) | Real synced JSONB column (`change_orders.audit_trail`). |
| `ScheduleAuditEntry` | `types/index.ts:672-706` | Already carries `changeOrderId` (`:686`) — the CO→schedule edge exists. |
| `RFIHandoff` / `RFIBallInCourt` | `types/index.ts:2953-2973`, on `RFI.handoffs` (`:2989`) | Append-only custody chain. Comment already says "Used for delay claim documentation." |
| `FieldTicketAuthorization` | `types/index.ts:4512-4525` | Typed name + drawn signature + `signedAt` + GPS. Sealed on leaving draft — `sealedFieldTicketViolations()` (`utils/fieldTicketCore.ts:226`) rejects any update touching captured content. |
| `ProjectPhoto` | `types/index.ts:2466-2511` | GPS at capture (`utils/photoGeoStamp.ts:56`), bytes in the private `project-photos` bucket at a deterministic path, signed URLs at read. |

Confirmed missing — zero matches across the entire repo, not just `types/index.ts`:
`NoticeEvent`, `DelayEvent`, `ClaimEvent`, `noticeDeadline`, `noticeSentAt`, `reservationOfRights`.

### 2.2 `DelayEvent` — the spine

One new type. It **references** evidence; it never copies it. Copying would create a second version
of a fact that can drift from the first, which is the exact failure mode a claim packet must not
have.

```ts
/** Why the delay happened. Drives the compensability default in §1.3. */
export type DelayCause =
  | 'weather'
  | 'owner_directed_change'
  | 'late_rfi_response'
  | 'differing_site_condition'
  | 'owner_supplied_item'
  | 'permit_or_inspection'
  | 'design_revision'
  | 'contractor_caused'      // logged honestly — see the concurrency note below
  | 'other';

/** §1.3. `unclassified` is the default: the app must not guess entitlement. */
export type DelayClassification =
  | 'excusable_compensable'
  | 'excusable_noncompensable'
  | 'nonexcusable'
  | 'unclassified';

export type DelayEvidenceKind =
  | 'photo' | 'daily_report' | 'rfi' | 'weather_log'
  | 'field_ticket' | 'comm_event' | 'schedule_audit' | 'change_order';

/** A pointer, not a copy. `capturedAt` is denormalized ONLY for chronological
 *  sort in the packet; the referenced row remains authoritative. */
export interface DelayEvidenceRef {
  kind: DelayEvidenceKind;
  id: string;
  capturedAt: string;
  note?: string;
}

export type DelayNoticeMethod =
  | 'portal' | 'email' | 'hand_delivered' | 'certified_mail' | 'courier' | 'other';

export interface DelayNotice {
  id: string;
  kind: 'initial' | 'supplemental' | 'reservation_of_rights';
  /** SERVER clock at the moment the notice was recorded — never the device's. */
  sentAt: string;
  method: DelayNoticeMethod;
  recipient: string;
  /** REQUIRED for kind==='reservation_of_rights'. A generic "reserves all
   *  rights" is void as a matter of law (see below) — the reservation must
   *  name the claim and state an amount. */
  reservedClaimDescription?: string;
  reservedAmount?: number;
  reservedDaysClaimed?: number;
  /** The rendered notice document, sealed like a contract. */
  documentPath?: string;
  documentHash?: string;
  /** Set when the notice went out through the client portal, which is the only
   *  channel where MAGE holds independent proof of receipt. */
  portalMessageId?: string;
}

export interface DelayEvent {
  id: string;
  projectId: string;
  /** Per-project sequential, rendered "DE-004". Same convention as FieldTicket. */
  number: number;
  cause: DelayCause;
  /** The date the GC first knew. THIS starts the notice clock — not createdAt,
   *  because a GC logging Monday's washout on Wednesday must not get two free days. */
  firstObservedDate: string;
  /** Date the causal condition ended, when it has ended. */
  endedDate?: string;
  description: string;

  evidence: DelayEvidenceRef[];

  /** Tasks the GC asserts were impacted. Critical-path status is DERIVED from
   *  runCpm() at render time, never stored — a stored flag goes stale the moment
   *  the schedule moves. */
  impactedTaskIds: string[];
  /** Calendar days claimed. GC-entered. */
  claimedDays: number;
  /** Days another delay ran concurrently. §1.3 — the honest field that makes the
   *  register survive cross-examination. */
  concurrentDays?: number;

  notices: DelayNotice[];
  classification: DelayClassification;

  /** The CO that resolved it, when one did. */
  changeOrderId?: string;

  auditTrail?: COAuditEntry[];   // reused, not re-invented — precedent at :4555
  sealedAt?: string;
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 2.2b Why the reservation of rights is three structured fields and not a text box

The obvious design — a "Reserve rights" checkbox with a notes field — **produces language that fails
as a matter of law.**

> ***Mingus Constructors, Inc. v. United States*, 812 F.2d 1387 (Fed. Cir. 1987)** requires that
> *"specific claims be excepted in stated amounts."* The court called generic language a
> **"blunderbuss exception"** and held: *"**Vague, broad exceptions … are insufficient as a matter of
> law to constitute 'claims'.**"* Still quoted by the CBCA as of 2024; accord *Enfield Enterprises v.
> DHS*, CBCA 7684 (2024) — *"The contractor bears the burden to identify and specify claims to be
> reserved **at the time a release is drafted**."*

What actually works is specific + contemporaneous + tied to the document:

> ***Fortis Industries, LLC v. GSA*, CBCA 7967 (Sept. 18, 2024)** — contractor signed the mod
> **unaltered** and returned it with a transmittal: *"I know you need this back now so I went ahead
> and signed, but this says all obligations except for June of 2022; however … we're still owed for
> May 2022 services as well."* **Split result: released as to unmentioned periods; survived summary
> judgment as to May 2022.** A vaguer earlier objection email was insufficient.
>
> ***MMR Constructors, Inc. v. Dow Chemical Co.*, No. 01-19-00039-CV (Tex. App.—Houston [1st Dist.]
> Dec. 3, 2020)** — the best private-project counter-example. Twelve mods releasing delay claims;
> ~$17.9M acceleration claim lost on summary judgment. ★ **The release even had a reservation slot
> ("EXCEPT THOSE CLAIMS PREVIOUSLY SUBMITTED IN WRITING") and it did not help, because the change
> request came 24 days after the last release. Timing, not the presence of a slot.**

**Product consequence:** `reservedClaimDescription` + `reservedAmount` + `reservedDaysClaimed` are
required when `kind === 'reservation_of_rights'`, and the app fires the prompt **at CO execution and
at the final Application for Payment**, not whenever the user thinks of it. A free-text
"reserves all rights" box is the anti-pattern, not the feature.

⚠️ **And the trap to never build.** A UI offering *"endorse the check under protest to preserve your
claim"* would be giving legally wrong advice. **UCC § 1-308(a)** does say "under protest" preserves
reserved rights — but **§ 1-308(b) switches it off entirely for accord and satisfaction**, and
Official Comment 3 repeats it: *"this section has no application to an accord and satisfaction."*
Under **UCC § 3-311**, a conspicuous full-satisfaction statement on a check for a disputed claim
discharges it on deposit. The only reliable escapes are: **don't deposit it**, or deposit and
**tender repayment within 90 days** (§ 3-311(c)(2)). If the product ever mentions this, it must say
*that*.

**What is a new type vs. a field on an existing one:**

| Change | Decision | Why |
|---|---|---|
| `DelayEvent`, `DelayNotice`, `DelayEvidenceRef` + 4 unions | **New** in `types/index.ts` | No existing type has the shape. Follows the file's grain: domain interface + string-literal unions + doc comments explaining the legal reason for each field. |
| `Project.noticePeriodDays?: number` | **New field**, beside `contractMode` (`types/index.ts:224`) | Per-project contract setting; sits with the other contract-delivery fields (`contractMode` `:224`, `gmpCap`, `contractorFeePercent`). |
| `Project.noticeMethodRequired?: DelayNoticeMethod` | **New field**, same place | A201 §15.1.3.2 requires certified mail/courier. The app must be able to warn that a portal message does not satisfy the clause. |
| `DelayEvent.auditTrail` | **Reuse `COAuditEntry`** | `FieldTicket` already reuses it (`:4554-4555`) with the comment "identical shape and semantics." Third reuse, zero new concepts. |
| Notice **deadline** | **Derived, never stored** | `firstObservedDate + noticePeriodDays`. Matches the codebase grain: `buildChaseList` derives `daysOverdue` from `dateRequired` and stores nothing (`utils/systemOfAction.ts:40-45`). A stored deadline goes stale when the contract setting is corrected. |
| Critical-path impact | **Derived at render** from `runCpm()` | Same reason. |
| `WeatherDelayLogEntry` | **Unchanged** | It is already correct. A weather DelayEvent references it via `DelayEvidenceRef{kind:'weather_log'}`. Do not touch a type this carefully built. |

### 2.3 Where it is stored — a real table, not the schedule blob

`delay_events`, a first-class Postgres table with RLS mirroring `change_orders`. **Not** a JSONB
array on `projects.schedule`.

This is not a style preference. `projects.schedule` is a single JSONB cell written by whole-row
upsert through the offline queue — the live-collaboration spec documents it as
*"two writers on one JSONB cell (whole-row upsert, last-write-wins clobber)"*
(`docs/superpowers/specs/2026-07-28-live-schedule-collaboration-design.md:31-36`).

**Which means the delay evidence MAGE already has is clobberable today.** `weatherDelayLog` lives in
that cell. Two devices, or one device and a stale bundle, and a carefully-provenanced weather delay
record is silently overwritten by whoever saves the schedule last. Nothing warns anyone. Legal
evidence must not live behind last-write-wins — that is the whole argument for a table, and it is
also a **pre-existing bug worth fixing on its own merits** (§7, Phase 0).

Three further reasons: a row can carry a per-row immutability trigger; a row can be sealed
independently; a row survives a schedule delete.

### 2.4 The edges this creates

```
                      ┌──────────────────────────────┐
   weather_log ──────▶│                              │
   photo       ──────▶│                              │──▶ notices[]  ──▶ portal / certified mail
   daily_report ─────▶│          DelayEvent          │
   rfi (handoffs) ───▶│  cause · firstObservedDate   │──▶ impactedTaskIds ──▶ runCpm() ──▶ critical?
   field_ticket ─────▶│  claimedDays · concurrent    │
   comm_event  ──────▶│  classification              │──▶ changeOrderId ──▶ ScheduleAuditEntry
   schedule_audit ───▶│                              │       (edge already exists, :686)
                      └──────────────────────────────┘
```

The `changeOrderId` → `ScheduleAuditEntry.changeOrderId` edge **already exists and is already
written** by `utils/coScheduleReflowCore.ts`. `DelayEvent` closes the loop backwards from the CO to
the cause, which is the direction a claim is actually argued.

### 2.5 Two derived numbers that must be computed a specific way

**RFI aging must measure the owner's/architect's time, never round-trip.**

> ***Caddell Constr. Co. v. United States*** (Fed. Cl. 2007) — the claimant failed in part because it
> measured total RFI turnaround *"including the time the RFIs were in Caddell's hands."* The court
> also noted that *"the fact that SSC issued RFIs, or even a large number of RFIs, **is not an
> indication that the plans were defective**."*

A dashboard showing round-trip RFI age is not merely less useful — it is the specific defect that
lost *Caddell*. **MAGE is unusually well positioned here:** `RFIHandoff` (`types/index.ts:2958-2973`)
is an append-only custody chain with `fromParty` / `toParty` / `at`, so *"days held by the
architect"* is a pure fold over `handoffs` and needs no new data. It is currently computed nowhere.

⚠️ **A real feature conflict that must be a hard project-level election, not a warning.**

> ***Active Construction, Inc. v. Dep't of Transportation*, CBCA 6597 (Mar. 9, 2022)** — *"It is
> impossible to see how ACI's effort to recover its field office overhead **both as a direct cost of
> delay and as an indirect cost markup to its other delay costs is anything other than
> double-counting**."* Contractor lost its **entire $688,347 claim on summary judgment.**

MAGE already applies overhead/fee markups (`Project.contractorFeePercent` `types/index.ts:230`,
`FieldTicket.markupPercent`). If a delay-damages calculator is ever added that charges extended
general conditions per diem, **the same field-office cost is recoverable one way or the other, never
both.** Model it as an explicit per-project election, because a soft warning produces exactly the
claim that lost in *Active Construction*.

---

## 3. The notice clock

### 3.1 Reuse, don't reinvent

Two established patterns, and the choice between them is a semantic one:

- **`utils/systemOfAction.ts` → `app/waiting-on.tsx`** is *"the app chases someone else for you."*
  `buildChaseList()` only emits items where the ball is in **someone else's** court
  (`utils/systemOfAction.ts:80` — `ball !== 'gc' && ball !== 'closed'`).
- **`hooks/useSmartInbox.ts`** is *"things you must act on, with expiry and dismissal."* Its nine
  rules (`:42-51`) are all obligations of the user: `overdue_invoice`, `rfi_past_due`,
  `coi_expiring`.

**A notice deadline is the GC's own obligation.** It belongs in `useSmartInbox`, not `waiting-on` —
putting it in the chase list would invert that file's stated contract ("chasing yourself is noise",
`utils/systemOfAction.ts:56`).

### 3.2 Design

| Piece | Where | Shape |
|---|---|---|
| Pure computation | **New** `utils/noticeClock.ts` | `buildNoticeStatus({ events, project, nowMs }): NoticeStatus[]`. No React, no network, no clock — caller passes `nowMs`. Mirrors `systemOfAction.ts`'s stated purity contract (`:13`). |
| Day math | **Reuse** `daysPast()` semantics from `utils/systemOfAction.ts:40-45` | Note: there is **no** canonical date helper. `daysPast` (systemOfAction), `daysOverdue` (`utils/billingFlowCore.ts:223`), `daysBetween` (`utils/portalOwnerCore.ts:61`), and `parseISODate` (`useSmartInbox.ts:366`) all coexist. Use `daysPast`'s noon-anchored parse — it is the one that handles bare `YYYY-MM-DD` without timezone drift, which is exactly the failure mode that would silently move a legal deadline by a day. |
| Inbox surface | **Extend** `InboxRule` (`hooks/useSmartInbox.ts:42-51`) with `'notice_deadline'` | Category `'schedule'`. Severity: `daysRemaining <= 1 → 3`, `<= 3 → 3`, `<= 7 → 2`, else `1`. Renders in `components/SmartInbox.tsx`, `app/(tabs)/(home)/index.tsx`, `components/DesktopActionRail.tsx` with zero further work. |
| Escalation | **New** edge fn `notice-deadline-watch` + cron | Copy `coi-expiry-watch` exactly: daily `pg_cron` HTTP POST, idempotent via a per-event `notice_last_warned_threshold` column. Thresholds **7 / 3 / 1 / 0 days remaining** (COI's are 30/14/7/0). |
| Setting | `Project.noticePeriodDays` | **Default: unset.** See below. |

### 3.3 The default must be "unset," and the app must ask

Shipping `noticePeriodDays = 21` as a default is the product telling a contractor what their
contract says. It does not know that. A GC on a 7-day residential agreement would get a clock that
runs 14 days too long and a false sense of safety — strictly worse than no clock.

**Behavior:** when a project has no `noticePeriodDays`, the first `DelayEvent` blocks on a one-time
prompt — *"What does your contract give you for written notice of a delay? Check your agreement —
it's usually 7, 14, or 21 days."* Presets for 7/14/21 plus custom, plus "I don't know," which sets a
conservative **7** and labels every downstream deadline **"assumed — verify your contract."**

That labeling pattern already exists in this codebase and is the right precedent: the estimate
wizard branches its copy on whether grounding facts exist rather than claiming history it does not
have (`docs/superpowers/specs/2026-08-02-product-audit-design.md:305-307`).

### 3.4 Constructive acceleration needs the notice TWICE — and everyone misses the second one

If the owner refuses or sits on a legitimate extension request and still demands the original
completion date, the GC may have a constructive-acceleration claim. Five elements:

> ***Fraser Construction Co. v. United States*, 384 F.3d 1354, 1361 (Fed. Cir. 2004)** — *"(1) … a
> delay that is excusable under the contract; (2) … a **timely and sufficient request for an
> extension**; (3) … the government denied the request or failed to act on it within a reasonable
> time; (4) … the government insisted on completion … within a shorter period …, **after which the
> contractor notified the government that it regarded the alleged order to accelerate as a
> constructive change in the contract**; and (5) … the contractor was required to expend extra
> resources."*

★ **Element 4 is a second, separate notice, and it is the most-missed element in this body of law.**
Also, the extension request in element 2 **must state an amount of time** — an open-ended request
fails elements 2 and 3 (*Zafer Taahhut Insaat v. United States*, 833 F.3d 1356, 1362 (Fed. Cir.
2016)).

**Both are one-field fixes.** `DelayEvent.claimedDays` is already required, which satisfies *Zafer*.
Add a derived inbox prompt: when a `DelayEvent` has an `initial` notice, no `changeOrderId`, and the
notice is older than a reasonable-response window, surface *"the owner hasn't responded — if they're
still holding you to the original date, you may need to notify them you consider it acceleration."*
That is `kind: 'supplemental'` on an existing type — no new schema.

### 3.5 One thing the clock must say out loud

If `Project.noticeMethodRequired` is `certified_mail` or `courier` and the GC records a notice with
`method: 'portal'`, the event shows a warning: **"Your contract requires certified mail or courier
with proof of delivery. A portal message may not satisfy A201 §15.1.3.2."** Recording notice in
MAGE is not the same act as serving notice under the contract, and the product must never let those
two blur.

---

## 4. Sealing beyond contracts

### 4.1 What exists

| Mechanism | File | Guarantee | Limit |
|---|---|---|---|
| `seal-document` edge fn | `supabase/functions/seal-document/index.ts` | Server re-downloads the stored bytes, recomputes SHA-256, refuses on mismatch (`:112-116`), writes `signed_pdf_url` + `document_hash` (`:120-125`) | **Contract-only by construction:** `requireTier()` at `:62` needs an authenticated MAGE user; `project_contracts` is hardcoded at `:93` and `:121`; the `secure-contracts` bucket at `:103`; and `storage_path` must start with the caller's own `userId/` (`:80`). |
| `portal_submit_co_approval_signed` | `supabase/migrations/20260803120500_portal_co_esignature.sql` | pgcrypto `digest()` recompute server-side (`:102`), server clock `now()` (`:78`), ESIGN elements enforced (`:90-97`), audit entry appended to `change_orders.audit_trail` (`:146-150`) | Token-gated to one portal; CO-specific. |
| `freeze_certified_aia_pay_app` | `supabase/migrations/20260728120000_lock_certified_aia_pay_apps.sql` | **BEFORE UPDATE** trigger: once `certified_at` is non-null, any change to financial columns raises `check_violation`, with an explicit allowlist of columns that stay writable | **Does not block DELETE.** |
| `sealedFieldTicketViolations` | `utils/fieldTicketCore.ts:226-233` | App-layer allowlist (`SEALED_FIELD_TICKET_MUTABLE_KEYS`, `:209`) | App layer only — a direct PostgREST call bypasses it. |

### 4.2 The call: three mechanisms, because there are three jobs

**Do not generalize `seal-document` into a "seal any row" function.** Passing a table name and
column names from a client is an injection surface and an authorization surface — you would have to
maintain a per-table ownership check server-side anyway, at which point the "generic" function is
just a switch statement with extra risk.

The portal RPC's own header already made this argument, and it was right
(`20260803120500_portal_co_esignature.sql:18-28`): *"Rather than force a bad fit, this reproduces
seal-document's ACTUAL guarantee … inside the token-gated portal RPC pattern."*

| Job | Mechanism | Follows |
|---|---|---|
| **Row-seal a structured record** (a `DelayEvent`, a `DelayNotice`) | New SECURITY DEFINER RPC `seal_delay_event(p_id)`. Server builds a **canonical serialization** of the row (fixed key order, no whitespace), `encode(digest(…,'sha256'),'hex')`, stores `content_hash` + `sealed_at := now()`. | `portal_submit_co_approval_signed` |
| **Make a sealed row immutable** | BEFORE UPDATE trigger, mutable-column allowlist, **plus a BEFORE DELETE trigger** — the gap the pay-app pattern leaves. | `freeze_certified_aia_pay_app`, extended |
| **Byte-seal a rendered PDF** (the claim packet, a notice letter) | **Narrowly extend `seal-document`** with a `record_type` discriminator validated against a server-side allowlist mapping `record_type → {table, bucket, id_column}`. Three entries: `contract` (existing behavior, unchanged), `delay_notice`, `claim_packet`. The client never names a table. | `seal-document`, minimally widened |

The GC is authenticated for all three, so `requireTier()` is not an obstacle here — it only was for
the homeowner. Keep it at all-tiers, matching the existing "legal-grade primitive, not a paywall
lever" decision (`seal-document/index.ts:61`).

### 4.3 One honest note on the portal RPC's hash check

`20260803120500_portal_co_esignature.sql:103-104` only compares hashes when the client actually sent
64 hex chars:

```sql
if p_client_hash is not null and length(p_client_hash) = 64
   and lower(p_client_hash) <> lower(v_server_hash) then
```

Omit `p_client_hash` and the comparison is skipped — the row still stores a server-computed hash
over the exact bytes stored, so **the tamper-evidence property is intact**, but the "client and
server agreed on what was signed" property is not enforced. `seal-document` is stricter: it 400s on
a malformed `client_hash` (`:75`).

In fairness the check is nearly decorative in the RPC anyway — record and hash arrive in the *same*
call from the *same* client, so it can only catch transport corruption. In `seal-document` it is
meaningful because the bytes travel via Storage and the hash via the function, so it proves two
independent channels agree. Worth a comment in the migration; not worth a behavior change.

---

## 5. The export

### 5.1 What "auto-generates a legal ledger" actually produces

`utils/claimPacketPdf.ts`, built on the existing infrastructure — `utils/pdfDesign.ts` supplies
`pdfShell`, `pdfHeader`, `pdfTitle`, `pdfTable`, `pdfSectionHeader`, `pdfStatGrid`, `pdfFooter`,
`PDF_DISCLAIMERS` (`:17-246`); `utils/financialReportPdf.ts` is the closest structural template
(`buildWIPHtml` → `shareWIPReport`). Rendering is expo-print HTML→PDF; page breaks via
`<div class="page-break">`.

| § | Section | Source |
|---|---|---|
| A | **Cover + contract facts** — parties, contract value, contract completion date, `noticePeriodDays` and whether it was confirmed or assumed | `ProjectContract`, `Project` |
| B | **As-planned baseline** — the earliest baseline, ideally `reasonCode: 'as_bid'` | `ProjectSchedule.baselines` (`types/index.ts:815-821`); `NamedBaseline` w/ `reasonCode`, `capturedBy`, `savedAt` (`utils/scheduleOps.ts:83-106`) |
| C | **As-built actuals** | `ScheduleTask.actualStartDay` / `actualEndDay` / `actualStartDate` / `actualEndDate` / `progress` |
| D | **Variance table** — planned vs. actual per task, largest slip first | `diffAgainstBaseline()` (`utils/scheduleOps.ts:248`) — already returns `startDelta` / `durationDelta` / `endDelta`, already sorted |
| E | **Delay register** — every `DelayEvent` chronologically: cause, first observed, notice given (date, method, recipient), days claimed, days concurrent, classification, resulting CO | `delay_events` |
| F | **Evidence pages** — per event, its `DelayEvidenceRef[]` resolved: photos with GPS + capture time, weather log entries **with their `source`**, RFI handoff chains, field tickets with the owner's signature | the six primitives |
| G | **Schedule change history** — every `ScheduleAuditEntry`, `changeOrderId` shown where present | `ProjectSchedule` |
| H | **Verification appendix** | §5.2 |
| I | **Disclaimer** | new `PDF_DISCLAIMERS.claimPacket` (§6.7) |

**Section F must print `WeatherDelayLogEntry.source` on every weather row**, and must render a
`'mixed'` entry with its `simulatedDates` visibly excluded and labeled. The type's own comment says
those dates are "NOT admissible as delay documentation" (`types/index.ts:780-782`). A packet that
quietly drops that distinction re-introduces the exact defect that was just fixed.

### 5.2 The verification appendix

The part that makes it checkable by someone who does not trust the GC:

1. **Manifest** — one row per sealed artifact: type, id, `sealed_at` (server clock), SHA-256.
2. **The packet's own hash**, sealed via `seal-document` with `record_type: 'claim_packet'`.
3. **Instructions a third party can follow without MAGE**: `shasum -a 256 <file>` and compare. This
   is the `FRE 902(14)` "process of digital identification" — an original-vs-copy check.
4. **A plain statement of what the hashes do and do not establish**, in the document itself. See
   §6.7.

### 5.3 What the packet must not do

No "MAGE concludes the owner caused N days." The product assembles and narrates; the GC asserts;
their attorney argues. `classification` is a **GC-entered field with an `unclassified` default** —
the app may suggest a default from `cause` (weather → `excusable_noncompensable`,
owner_directed_change → `excusable_compensable`) but must show it as an editable suggestion, never
as a finding.

---

## 6. What would make this NOT unassailable

**This section is the reason to build the feature carefully instead of quickly.** Every item is a
real hole. None is hypothetical.

### 6.1 The hashes live in the same database as the data they attest

`project_contracts.document_hash`, `change_order_approvals.document_hash`, and the proposed
`delay_events.content_hash` are columns in the same Postgres instance as the rows they cover. There
is **no external anchor** and **no trusted timestamp authority**.

Against an adversary who alleges the GC controls the database, a hash stored beside its own data
proves nothing — you can recompute both. It defends against *accidental* alteration and against a
*third party* altering a stored file. It does not defend against the record's owner.

The recognized fix is an **RFC 3161** Time-Stamp Protocol token from an independent TSA, which binds
a hash to a time attested by someone other than you. In the EU, eIDAS Art. 41 gives qualified
timestamps an explicit legal effect. **There is no equivalent US federal statutory presumption for
timestamps that I could verify — UNVERIFIED, and worth an attorney's answer before any claim rests
on it.** ESIGN/UETA give legal effect to electronic signatures and records; they are not a timestamp
authority regime.

Blockchain anchoring is the other option, and Vermont's **12 V.S.A. § 1913** is the clearest US
statute on it — but reading it closely is instructive, because it shows an anchor is *not* a
shortcut past the hard part. It makes a blockchain-registered record self-authenticating under
Vermont Rule of Evidence 902 **only if accompanied by a written declaration of a qualified person,
made under oath**, stating when the record entered and was retrieved from the blockchain and that it
was maintained as a regularly conducted activity. And it draws exactly the line §1.5 draws:

> the presumption **"does not extend to the truthfulness, validity, or legal status of the contents
> of the fact or record."**

So even the most favorable US statute on the books gives you *this record is what it was when
anchored* — the same thing SHA-256 already gives — plus a human custodian declaration MAGE does not
currently produce. **Whether US courts have actually admitted blockchain-anchored construction
evidence is UNVERIFIED** and must not be asserted.

**Recommendation:** defer both (§7, Phase 4). Do not build a TSA integration for a product with no
users. **But do not describe the current hashing as anything an external anchor would be needed
for.** This is the gap that most tempts overclaiming.

### 6.2 Device clocks are trivially settable

Almost every timestamp in the evidence set is generated by the client:

| Field | Clock |
|---|---|
| `ProjectPhoto.timestamp` (`types/index.ts:2494`) | device |
| `FieldTicketAuthorization.signedAt` (`:4518`) | device |
| `COAuditEntry.timestamp` from `client-view.tsx` / `field-ticket.tsx` / `leakCoDraft` | device |
| `ScheduleAuditEntry.at` | device |
| `WeatherDelayLogEntry.appliedAt` | device |
| `change_order_approvals.sealed_at` | **server** (`now()`, `20260803120500…sql:78`) |

One field in that list is trustworthy. A user who sets their phone back three days can create a
"contemporaneous" record dated before the event it describes, and nothing in the system notices.
Offline-first makes this worse: the offline queue legitimately writes records long after the device
timestamp they carry.

**Recommendation (Phase 2, cheap, high value):** store **both** clocks on every claim-relevant
record — the device's `capturedAt` and a server-stamped `receivedAt` (`DEFAULT now()`, or set in the
RPC). Then the packet can show the skew and the GC can explain a 6-hour offline gap honestly. This
is strictly better than a single timestamp of unknown provenance, and it is the difference between
"the record says Tuesday" and "the device claimed Tuesday; our server received it Tuesday 6:14pm."

### 6.3 GPS is spoofable

`utils/photoGeoStamp.ts:56` reads the OS location API with `Accuracy.Balanced`. The OS reports what
it is told to report — developer location simulation, a jailbroken device, or a desktop browser with
devtools open all produce a clean, plausible fix. `readWebLocation()` in particular is browser
geolocation, which is the easiest of all to override.

A GPS stamp is **corroborating** evidence — it agrees with the other records, or it does not. It is
not proof of presence. The packet may print it; the product may not call it proof.

### 6.4 Sealed rows are still deletable

Verified directly against production `pg_policies`:

| Table | DELETE policy |
|---|---|
| `project_contracts` | `contracts_gc_delete` — `auth.uid() = user_id` |
| `change_orders` | `change_orders_delete`, `co_delete_own` — `auth.uid() = user_id` |
| `photos` | `photos_delete`, `photos_delete_own` — `auth.uid() = user_id` |
| `rfis`, `daily_reports`, `comm_events` | same pattern |
| `change_order_approvals` | **none — RLS default-deny. Already effectively append-only.** |

So a **sealed contract row can be deleted by its owner.** `freeze_certified_aia_pay_app` blocks
UPDATE and says nothing about DELETE. The one table that got this right got it right by omission.

Worse: `supabase/functions/delete-account/index.ts:53-64` hard-deletes `change_orders`, `photos`,
`comm_events`, `rfis`, `daily_reports`, `aia_pay_apps` and 20 more tables with the service role, and
its storage cleanup covers only the `pdf-uploads` bucket (`:66-72`) — so sealed PDFs in
`secure-contracts` outlive the rows that referenced them, and the evidence set is destroyed while
its bytes are orphaned. That is a GDPR-correct feature and an evidence-retention disaster at the
same time, and the tension is real, not a bug to "fix."

There is **no litigation hold** concept anywhere. Under **FRCP 37(e)**, once litigation is reasonably
anticipated, failure to preserve ESI can support curative measures or, on a finding of intent to
deprive, an adverse-inference instruction. A product that markets claim defense and silently allows
one-tap destruction of the claim file is selling the opposite of what it advertises.

**The case law says precisely how to build the hold** — and there is a construction one:

> ***Skanska USA Civil Southeast Inc. v. Bagelheads, Inc.*, 75 F.4th 1290 (11th Cir. 2023)** — a
> **construction contractor** ESI spoliation case at the circuit level. *"Even with an active
> litigation hold and actual litigation, Skanska did not back up the relevant employees' cell
> phones. Nor did it suspend its ordinary … data destruction policies."* … *"**Skanska had an active
> litigation hold, but took no steps to implement it.**"* Phones were wiped under **ordinary
> employee-departure procedures**. Two adverse inferences plus fees, affirmed.
>
> ***In re Google Play Store Antitrust Litig.*, 664 F. Supp. 3d 981 (N.D. Cal. 2023)** — the
> auto-deletion-defaults case. *"Google chose instead to let employees make their own personal
> choices about preserving chats."* ★ **The court-ordered remediation reads as a feature spec:**
> history forced on for all held custodians, and *"**These employees will not have the ability to
> change history to 'off'.**"*

★ **The through-line: a hold that depends on end-user action is the sanctions fact pattern.** Enforce
it server-side, make it non-overridable by the custodian, log acknowledgment, and provide an explicit
release. That is also Sedona's *Commentary on Legal Holds* (2d ed.) Guideline 8, which expressly
names *"auto-delete functionality that should be suspended."*

⚠️ **But do not market it as curing a per-se risk.** ***Chin v. Port Authority*, 685 F.3d 135, 162
(2d Cir. 2012)**: *"We reject the notion that a failure to institute a 'litigation hold' constitutes
gross negligence per se."* Every circuit to reach it also requires **intent** under 37(e)(2), not
negligence — 2d (*Hoffer v. Tellone*, 2025, holding the standard is **preponderance** and that the
**court, not the jury**, finds intent), 6th (*Applebaum v. Target*, 831 F.3d 740, 745 (2016) — *"A
showing of negligence or even gross negligence will not do the trick"*), 9th, 11th. ⚠️ Some **state**
law is broader (NY: *VOOM HD Holdings v. EchoStar*, 93 A.D.3d 33 (1st Dep't 2012) — *"a 'culpable
state of mind' … includes ordinary negligence"*), but **not uniformly** — Texas contrasts
(*Brookshire Bros. v. Aldridge*, 438 S.W.3d 9 (2014)). Do not write "state law is always broader."

**MAGE's own exposure, which is the part a vendor forgets:** a customer's discovery obligation reaches
data held in your platform.

> ***Brown v. Tellermate Holdings Ltd.*, 2014 WL 2987051 (S.D. Ohio July 1, 2014)** — a Salesforce
> case. *"January, 2014 was fairly late in the game to attempt to confirm the (mistaken) assumption
> that salesforce.com was doing the preservation work **which was Tellermate's responsibility all
> along**."* The provider's retention window had already destroyed the data. Sanction: preclusion of
> the entire defense plus fees, **against client and counsel jointly**.

Two consequences: (a) MAGE's retention window is a discovery fact for its customers and belongs in
the docs, not just the ToS; (b) ⚠️ **any preservation promise MAGE makes — in the ToS, a DPA, a
hold-acknowledgment feature, or a support rep saying "we'll preserve that" — is exactly the
contract / voluntary-assumption hook that creates third-party spoliation exposure** in the states
recognizing that tort (*Hannah v. Heeter*, 213 W. Va. 704 (2003): a duty may arise *"through a
contract, agreement, statute, administrative rule, voluntary assumption of duty … or other special
circumstances"*). **Legal review before shipping any preservation commitment.** Note the two leading
surveys disagree on how many states recognize the tort (10 vs. 14) — **do not put a number in the
product.**

**Retention is not one clock.** A "delete after N years" setting keyed to project end would be wrong
in both directions. It is a `max()` over several periods with **different trigger events**:

| Driver | Period | Trigger |
|---|---|---|
| State statute of repose | **4–20 yr** (TN 4; most 6–10; PA 12; IA 15; MD 20 for non-design/build defendants) — **NY and VT have none at all** | substantial completion, defined differently per state |
| AIA A102/A103 Art. 11, A133/A134 Art. 10 | 3 yr **floor**, *"or such longer period as may be required by law"* | **final payment** |
| A201 §15.1.2 outside limit on claims | 10 yr | — |
| OSHA 300 logs (29 CFR 1904.33(a)) | 5 yr | **end of the calendar year covered** |
| Davis-Bacon payrolls (29 CFR 5.5(a)(3)(i)(A)) | 3 yr | completion of the **prime** contract |

⚠️ **A201 itself has no record-retention clause** — §3.11 is an as-builts obligation with no period,
and §9.10.4.4's only mention of "audit" is a carve-out from waiver, not a grant. **A project on A101
(stipulated sum) has no AIA retention obligation at all.** A UI displaying "3 years (AIA)" would be
materially misleading on most projects. Default long (10 yr+), let it be configured, and never
compute a repose date without a state.

**Recommendation (Phase 2):** BEFORE DELETE trigger on sealed rows; a project-level `legal_hold_at`
that is **server-enforced and not clearable by the custodian who set it**, blocking account deletion
from touching that project's evidence with an explicit "this project is under legal hold" refusal
rather than a silent skip.

### 6.5 The GC authors almost all of it

Self-serving records made by the claimant are the weakest category of evidence in the packet. The
strongest artifacts MAGE produces are the ones **the counterparty signed**:

- the portal CO e-signature — drawn signature, typed legal name, ESIGN/UETA consent, server-side
  re-hash, server clock;
- the field ticket authorization — the owner's rep signing on site for hours and quantities.

**Design consequence:** the packet should visually separate **counterparty-attested** evidence from
**contractor-authored** evidence, and the product should push the GC toward getting things
countersigned. That is a genuinely better claim posture than any amount of hashing, and it costs
nothing to build — it is a section header and a sort order.

### 6.6 Nobody has tested this against a dispute, and no attorney has read it

Stated plainly because it is the truest limitation here:

- **No construction attorney has reviewed** this design, the notice-period presets, the packet
  layout, or the disclaimer language.
- **No packet has ever been produced, served, or challenged.** Every claim about how it would
  perform is a prediction.
- **The FRE 902(13)/(14) route requires a certification by a qualified person and advance notice to
  the opposing party.** MAGE has no custodian-declaration workflow. Hashes without that certification
  are useful for authentication argument; they are not self-authenticating on their own.
- **Notice periods are jurisdiction- and contract-specific**, and telling a GC "your notice is due
  Thursday" is uncomfortably close to legal advice. Frame it as a reminder about *their* contract
  setting, which *they* entered, and never as MAGE's reading of their contract.
- `marketing/terms.html:97,100` currently says MAGE "is not a party to any agreement" and "won't
  mediate or arbitrate." Marketing a claim-defense product creates a reliance surface those terms
  were not written against. Flag for counsel.

### 6.7 Recommended claim language

**Nothing to walk back yet.** `grep -ri "unassailable\|legal ledger\|court-admissible"` across
`marketing/`, `app/`, `components/`, `utils/`, and `docs/` returns **zero product or marketing
hits**. The founder's phrasing is a pitch, not a shipped claim. This is the rare chance to set the
language *before* it goes out rather than delete it after.

The house term already exists and is the right one: **"tamper-evident"**
(`docs/superpowers/plans/2026-05-19-s1-2-seal-document-contracts.md:5`).

**May say — each is literally true of the built system:**

- "Tamper-evident." *(the stored hash breaks if the bytes change)*
- "Hash-verified — the server recomputes the hash over the exact bytes it stores and refuses on mismatch."
- "Timestamped by our server." *(only where true — §6.2)*
- "Contemporaneous — captured in the field, at the time, not reconstructed afterward."
- "A complete, chronological, evidence-linked record of every delay — the file your attorney would otherwise pay someone to assemble."
- "Never records a weather delay it can't evidence." *(uniquely true, and provable)*
- "Tracks your contract's notice deadline so a real claim isn't lost to a missed window."

**Must not say:**

| Forbidden | Why |
|---|---|
| "Unassailable" | Nothing is. §6.1–6.5 are five independent ways to assail it. |
| "Court-admissible" / "legally binding proof" | Admissibility is a judge's ruling on a record and a foundation, not a property of a file format. |
| "Proves the owner caused the delay" | Causation is argued from evidence; software assembles evidence. |
| "Immutable" (unqualified) | The rows are deletable by their owner today (§6.4). "Immutable once sealed" only after the triggers ship — and even then, only against UPDATE. |
| "Blockchain-grade" / "cryptographically guaranteed" | There is no external anchor (§6.1). |
| "Will win your claim" / any outcome claim | Obviously. |
| "Owner-caused delay defeats liquidated damages" | **Not automatic.** *Opinski*, *Dugan & Meyers* — not if you blew the notice/CO procedure (§1.1). |
| "The owner granted extensions, so they've admitted fault" | **False.** *Wilner* (en banc): the parties start *"with a clean slate"* (§1.2). |
| "CPM is required to prove delay" | **Conditional** — required where the contract mandates CPM or the contractor kept CPMs. Small residential contracts don't (§1.4). And do not invert it into "MAGE replaces a CPM analysis." |
| "Entitlement / causation / quantum" attributed to a court | Consultant vocabulary. Courts say liability / causation / resultant injury (§1.2). |
| "Endorse the check under protest to preserve your claim" | **Legally wrong.** UCC § 1-308(b) + Cmt. 3 switch it off against accord and satisfaction (§2.2b). |
| "Reserve all rights" as sufficient CO language | **Fails.** *Mingus* — "blunderbuss exception," *"insufficient as a matter of law"* (§2.2b). |
| "AIA requires 3-year record retention" | **A201 has no retention clause.** A102/A103 and A133/A134 do, as a **floor**; A101 has none (§6.4). |
| "Failing to issue a litigation hold is gross negligence" | **False per se.** *Chin*, 685 F.3d at 162 (§6.4). |
| "Self-serving daily reports get excluded" | **Wrong theory** — the Advisory Committee says self-serving is not a ground for exclusion. Routineness under 803(6)(C) is the real attack (§1.5). |
| Any count of states recognizing an independent spoliation tort | The two leading surveys say 10 and 14, and the 14-state list does not exist as an enumeration (§6.4). |

**The single sentence to use in marketing:**

> **MAGE builds your delay file as the job happens — every weather day, RFI handoff, field photo,
> and owner signature captured in the moment, hash-sealed so any later change is detectable, and
> exported as one chronological, verifiable packet. It won't win your case. It's the record that
> makes a case possible.**

**The disclaimer to add to `PDF_DISCLAIMERS`** (`utils/pdfDesign.ts:162`), matching the honest tone
of the existing `dfr` and `fieldTicket` entries:

```ts
claimPacket:
  'This packet was assembled by MAGE ID from records captured during the project. The SHA-256 ' +
  'hashes in the verification appendix establish that each sealed record is byte-identical to ' +
  'what was sealed at the stated time; they do not establish that the underlying events occurred ' +
  'as described, and timestamps not marked "server" originate from the recording device\'s clock. ' +
  'This is a compilation of business records, not a legal opinion, an expert schedule analysis, ' +
  'or a certification of entitlement. Notice periods shown reflect the contract terms entered by ' +
  'the contractor. Consult a construction attorney before relying on this document in a dispute.',
```

---

## 7. Phasing

**Blocking fact:** the last migration applied in production is `20260730142849_public_price_index`.
**Four** migrations are written and unapplied — the ground truth said three:

| Migration | Status |
|---|---|
| `20260803120000_invoice_milestone_link.sql` | not applied |
| `20260803120500_portal_co_esignature.sql` | not applied — **portal CO e-signature does not exist in production** |
| `20260803140000_collaborator_rls_field_tables.sql` | not applied |
| `20260803150000_change_order_schedule_impact.sql` | not applied |

Plus `supabase/migrations/create_field_tickets.sql`, which carries no version prefix and whose
`field_tickets` table **does not exist in production** (verified via `information_schema.tables`).
The field-ticket feature has no backing table at all.

So the two strongest counterparty-attested artifacts in §6.5 — the portal CO e-signature and the
signed field ticket — are **both unshipped**. Building a claim-defense feature on top of them is
building on nothing.

### Phase 0 — Apply what is already written. Build nothing.

Apply the four migrations plus `create_field_tickets.sql` (versioned properly first). Verify each
against production. Nothing in this spec is worth starting before this is done, and `Phase 0` may
well be a day's work that makes the product meaningfully more defensible on its own.

**Also in Phase 0, because it is a live data-loss bug independent of this feature:** `weatherDelayLog`
lives in the `projects.schedule` JSONB cell under last-write-wins (§2.3). Either move it to a table
or document the exposure. Evidence that a second device can silently erase is not evidence.

### Phase 1 — `DelayEvent` + the notice clock. **Ship this first.**

`delay_events` table + RLS; the types in §2.2; evidence linking from the six primitives; the
`noticeClock.ts` pure module; the `notice_deadline` inbox rule; the contract-notice prompt (§3.3);
`scripts/validate-notice-clock.ts` in ship-check, matching the repo's 100+ `validate-*.ts` pattern.

**No sealing, no PDF, no cron in Phase 1.** The notice clock alone is the highest-value piece in
this entire document: it is the only part that prevents a loss rather than documenting one, and it
is worth money on the first delay a user has. Everything else improves a claim that already exists.
*Opinski* (§1.1) makes it stronger still — the clock protects against owing LDs on a delay that was
not even your fault.

**Cheap Phase 1 additions, each with a case behind it:**

| Addition | Authority | Cost |
|---|---|---|
| Owner/architect RFI hold-time (fold over the existing `RFIHandoff` chain), never round-trip | *Caddell* (§2.5) | S — data already exists |
| Required days-amount on every extension request | *Zafer* (§3.4) | XS — `claimedDays` already required |
| Constructive-acceleration second-notice prompt | *Fraser* element 4 (§3.4) | S |
| Reservation prompt fired at CO execution and final pay app, with required claim + amount | *Mingus*, *Fortis*, *MMR* (§2.2b) | S |
| Daily-report completion streak including "nothing happened" days | FRE 803(6)(C), *Meltech* (§1.5) | S — and it is a retention feature that happens to be an evidentiary one |

### Phase 2 — Integrity.

Server clocks alongside device clocks (§6.2); `seal_delay_event` RPC; BEFORE UPDATE **and BEFORE
DELETE** triggers on sealed rows (§6.4); `legal_hold_at` + `delete-account` respecting it; the
`notice-deadline-watch` cron. Also the two audit gaps the product audit already found and that this
feature depends on: GC-side CO status changes write no audit entry
(`app/change-order.tsx:579` — `updateChangeOrder(existingCO.id, { status: next })`, and note the
audit's `:548` citation has drifted), and budget/estimate edits have no audit trail at all. **DB
triggers, not app hooks** — they catch every write path, including PostgREST.

### Phase 3 — The packet.

`utils/claimPacketPdf.ts`, sections A–I; `record_type` allowlist in `seal-document`; the
verification appendix; `PDF_DISCLAIMERS.claimPacket`.

### Phase 4 — Defer explicitly. Do not build.

External anchoring (RFC 3161 TSA or blockchain), a custodian-declaration workflow for FRE
902(13)/(14), and attorney review of the packet. **Attorney review should happen before any
claim-defense marketing copy ships, which may well be before Phase 3** — it gates the *language*,
not the code.

### What waits, and why

| Deferred | Why |
|---|---|
| Modeled delay analysis (impacted as-planned, collapsed as-built) | `runCpm()` could support it, but §1.4 — these are an expert's methods and a small GC cannot defend one on the stand. |
| Automatic classification of entitlement | §5.3. Suggest, never conclude. |
| `comm_events` write-through on state changes | Real gap (the table has **0 rows in production** — even the `internal_note` path at `contexts/ProjectContext.tsx:3357` has never fired, and it writes `isPrivate: true`, which is not a communication record). But Phase 2's DB triggers are the better vehicle than retrofitting `addCommEvent` calls. |
| Multi-project / portfolio claim view | No users. |

---

## Open questions

1. **Does `DelayEvent` supersede `weatherDelayLog`, or reference it?** This spec says reference — the
   weather type is correct and battle-tested. Revisit if the double-entry becomes confusing in the UI.
2. **Notice period on `Project` or on `ProjectContract`?** Spec says `Project`, beside `contractMode`,
   because a project can have delays before a contract row exists. `ProjectContract` has `startDate`
   and `durationDays` but no notice field either way.
3. **Tier gating.** `seal-document` is deliberately all-tiers ("legal-grade primitive, not a paywall
   lever"). Is the claim packet the same, or is it the Pro/Business feature that justifies the
   price? Founder's call. **Consistency argument: seal the records at every tier, gate the exported
   packet.** The evidence should never be behind a paywall; the convenience of assembling it can be.
4. **Does recording a notice in MAGE ever send anything?** §3.5 says the app must not blur recording
   with serving. Should Phase 2 generate a certified-mail-ready PDF, or integrate a service?
