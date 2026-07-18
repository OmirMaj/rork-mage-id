# MAGE Copilot — Universal Conversational-Automation Engine (Design Spec)

**Status:** decision-ready. Drives an implementation plan next.
**Scope:** ONE reusable engine + per-feature capability adapters. Flagship = Schedule.
**Grounded against the real repo** (files/types cited inline). No placeholders.

---

## 1. Goal & philosophy

MAGE Copilot is a single conversational-automation **engine**, built once, that every feature plugs into as a **capability**. The user speaks (phone) or types (web), the engine reads intent, runs an **adaptive, one-question-at-a-time, grounded** clarifying interview, confirms back, shows a review, and applies through the offline queue. Every feature reuses the same turn loop, transcript UI, tier gate, and sync path — features only declare *what makes their domain specific*.

Four principles, each already half-true somewhere in the repo:

1. **Grounding is the moat.** Every question, default, and confirmation cites the contractor's *own* history — learned unit costs (`utils/costDatabase.ts` `CostBookEntry.personalRate` / `suggestedRate` / `bidBias`), estimate calibration (`utils/estimateCalibration.ts` `computeCalibration`), past durations and items via project memory (`utils/projectMemory.ts` `retrieveRelevant` / `answerFromMemorySemantic`), and the live estimate line items on the project (`types/index.ts` `LinkedEstimate`). Competitors generate from generic templates; we generate from *your* jobs. The scheduler already ships this idea: every generated task carries a `rationale` and an `assumption` flag (`utils/scheduleGenSchema.ts`) — the engine generalizes "explain and flag every guess" to every domain.

2. **Ask only when it matters.** A question is asked **only** when the estimate / learned data / gap-rules cannot already resolve the field. If they can, the engine states a **confident grounded default** ("I'll size framing at 5 days — that's your last two 1,800 SF jobs") and moves on. This is what keeps it from being annoying on a 85 dBA jobsite. Concretely: each capability supplies a **gap-rule function** that inspects the current draft + grounding and returns *only the unresolved fields*; the engine asks about the highest-impact unresolved field, or stops.

3. **Phone = fast voice CREATE on-site; web = detailed EDIT at the desk.** Phone is low-tap voice-first (reuses `components/VoiceCaptureModal.tsx`, records 16 kHz mono WAV → `utils/transcribeAudio.ts`). Web (app.mageid.app) is the surface for heavy structural editing (dragging Gantt bars, editing estimate rows in a grid). **One synced data model:** both write through `utils/offlineQueue.ts` `supabaseWrite` and land in the same Supabase tables + context stores. Heavy structural edits (re-linking dependencies, re-pricing 40 estimate rows) **stay on web** until the NL-edit subset is production-safe (see §7).

4. **Last-Planner discipline — "the person doing the work plans the work."** The engine's interview is a structured conversation with the field super who actually knows the job, not a form the office fills in. Grounded questions surface *commitments and constraints* the way a Last Planner pull-plan does. The repo already has a Last Planner surface (`app/last-planner.tsx`, `hooks/useLastPlanner.ts`, `utils/lastPlanner.ts`) — Copilot feeds it (P2, §7), it does not replace it.

---

## 2. Why now / competitive gap

- **Procore** manages schedules; it does not *generate* one from your cost history and it has no grounded voice interview. Its "AI" is search/summarization over documents.
- **Houzz Pro** ships voice capture, but it's scoped to leads/notes/messaging, excludes schedule generation, and the schedule/estimate depth lives on desktop only — no on-site voice path into the plan.
- **Buildertrend / JobTree / JACK** offer forms and templates; none run a *multi-turn, grounded* interview that asks a clarifying question only when its own data can't answer it, then cites *your* learned rates in the answer.

No competitor combines: (a) grounded generation from the contractor's own closed-job cost book, (b) a one-question-at-a-time adaptive interview that suppresses questions it can already answer, and (c) a single voice-create / web-edit synced model. MAGE already has the three hard prerequisites shipped — a working AI relay with server tier gating (`utils/mageAI.ts` → `supabase/functions/ai`), a learned cost database (`utils/costDatabase.ts`), and an offline-first write path (`utils/offlineQueue.ts`). The engine is the connective tissue that turns those into a category-defining feature.

*(Positioning claims above are competitive-landscape summary, not benchmarked measurements.)*

---

## 3. The engine architecture

### 3.1 The `CopilotCapability` interface (what a feature registers)

A capability is a plain object registered in a central `utils/copilot/registry.ts`. It declares **exactly four things** plus display metadata. Types below are new (`utils/copilot/types.ts`); everything they reference already exists.

```ts
export interface CopilotCapability<Draft, Applied> {
  id: CopilotCapabilityId;              // 'schedule' | 'estimate' | 'daily_report' | 'change_order' | 'rfi' | 'punch' | 'safety_incident' | 'invoice'
  label: string;                        // "Build a schedule"
  featureKey?: FeatureKey;              // hooks/useTierAccess.ts gate; omit for free capabilities
  aiFeature: AIFeature;                 // utils/aiRateLimiterCore.ts meter bucket (e.g. 'scheduleCopilot')
  serverFeature?: string;              // supabase _shared/auth.ts MONTHLY_CAPS key (e.g. 'ai_text')

  // (1) GROUNDING PROVIDER — pulls the contractor's own history into a compact,
  //     serializable context the interview cites. Pure read; no network mutation.
  buildGrounding(ctx: CopilotContext): Promise<Grounding>;

  // (2) GAP-RULE FN — given the running draft + grounding, return ONLY the fields
  //     that are still unresolved, each with an impact weight and a grounded
  //     default the engine will state if the user skips. Empty array = ready to review.
  gaps(draft: Draft, grounding: Grounding): Gap[];

  // (3) QUESTION + DRAFT SCHEMA — the Zod schema for the accumulating draft, plus a
  //     turn-prompt builder that asks about ONE gap, citing grounding, and returns a
  //     schemaHint for mageAI. (See §3.3 for the double-turn discipline.)
  draftSchema: ZodSchema<Draft>;
  buildTurnPrompt(args: TurnPromptArgs<Draft>): { prompt: string; schemaHint: object };

  // (4) APPLY FN — turn the confirmed draft into real domain object(s) and persist
  //     them through the EXISTING context adders (which already wrap offlineQueue).
  apply(draft: Draft, ctx: CopilotContext): Promise<Applied>;

  reviewModel(draft: Draft, grounding: Grounding): ReviewModel;   // rows the review screen renders
  suggestions: string[];                // "Try saying…" seeds for VoiceCaptureModal
  topicChecklist?: { label: string; hint?: string }[];  // teleprompter for one-shot dictation
}

export interface Gap {
  field: string;
  impact: number;               // 0..1 — higher = ask sooner; below askThreshold = never ask, use default
  question: string;             // grounded, one sentence
  groundedDefault: { value: unknown; basis: string };  // basis is the citation shown if skipped
  kind: 'number' | 'text' | 'enum' | 'date' | 'choice';
  choices?: { label: string; value: unknown; basis?: string }[];
}
```

`CopilotContext` is assembled once by the shell and passed to every capability: the current `Project | null`, the `ProjectContext` adders (`addChangeOrder`, `addInvoice`, `addRFI`, `addPunchItems`, `addDailyReport`, `updateProject`, …), the `SafetyContext` adders, the resolved `SubscriptionTier`, and the built `CostDatabase` (`buildCostDatabase(projects, commitments, receipts)`). No capability touches Supabase directly — apply goes through the context adders, which already call `supabaseWrite`.

### 3.2 Stateless, turn-based edge-fn contract

The interview state machine lives **client-side** (in a pure reducer, testable). The edge function is the existing `supabase/functions/ai` relay via `utils/mageAI.ts` — **we do not add a stateful conversation server.** Each turn is one `mageAI({ prompt, schemaHint, tier, feature })` call whose prompt carries: (a) the capability's system role, (b) the serialized grounding, (c) the accumulated draft, (d) the user's latest utterance, and (e) an instruction to return *the updated draft plus which single field it still needs*. The relay stays stateless; the client owns the transcript and the draft. This inherits, for free, everything `mageAI` already hardened: 60 s abort, `errorKind` branching (`timeout`/`network`/`monthly_cap`/`unauthenticated`/`validation`), per-field Zod salvage (`salvageAgainstSchema`), null-stripping (`stripNulls`), and `MAX_TOKENS` graceful fallback. Server tier gate is the existing `requireTier` in `_shared/auth.ts` via the `feature` param on `mageAI`.

**Turn reducer** (`utils/copilot/turnReducer.ts`, pure):
```
State = { phase: 'idle'|'listening'|'thinking'|'asking'|'confirming'|'review'|'applying'|'done'|'error',
          draft, grounding, transcriptTurns[], askedFields[], questionCount, lastError? }
Actions: START(capId) · UTTERANCE(text) · AI_DRAFT(partialDraft, nextGap|null)
       · SKIP_QUESTION · EDIT_TRANSCRIPT(turnId,newText) · CONFIRM · CANCEL · APPLY_OK · APPLY_ERR
```
The reducer is where the **ask-only-when-unresolved discipline** and the **question cap** live — the two most testable pieces (§6).

### 3.3 Ask-only-when-unresolved (the ICLR double-turn principle)

The rule: **never ask a question the draft or grounding already answers.** Implementation is a two-stage gate per turn:

1. **Resolve pass.** After each AI draft, the engine recomputes `capability.gaps(draft, grounding)`. Any field whose grounded default is high-confidence (e.g. a `CostBookEntry` with `confidence: 'high'` and `variability < 0.15`, or a value the user already stated) is *removed* from the gap list and stamped as a confident default — it will appear in the confirm-back but is never asked.

2. **Double-turn confirm on the one thing that matters.** Of the remaining gaps, the engine asks about the single highest-`impact` field only. The "double turn" is: the model first *proposes* the grounded default inline ("I'll assume the master bath, since that's where your last three punch items landed — correct?") rather than asking an open cold question. The user confirms with one tap/word or corrects. This is strictly one clarifying exchange per unresolved high-impact field, and gaps below `askThreshold` (default 0.35) are **never asked** — the engine states the default and moves on. This is the discipline that makes it usable on-site: the modal asks the *fewest* questions that still produce a correct artifact.

**Question cap.** `MAX_QUESTIONS` (default 4, capability-overridable) hard-stops the interview; remaining gaps fall back to their grounded defaults and are shown (flagged) on the review screen for the user to fix at the desk. Prevents an interrogation loop.

### 3.4 Confirm-back + editable transcript

Jobsite noise (70–90 dBA) degrades STT, so the engine **never applies from raw transcript**. Every turn shows the transcribed utterance as an **editable** chip (tap to correct a mis-heard number before it feeds the draft) — reusing the pattern already in `VoiceCaptureModal` (which surfaces every failure inline and hands back a clean transcript string). Before apply, a **confirm-back** screen restates the whole draft in plain language with every grounded default labeled by its basis ("Framing 5d · *your 2 last 1,800 SF jobs*"; "Concrete $6.20/SF · *your cost book, high confidence*"). `assumption`/low-confidence rows are visually flagged exactly like the schedule review screen already flags `ScheduleTask.assumption`.

### 3.5 Error handling, escapes, tier gating

- **Escapes** at every phase: "Cancel" (discard), "Just save what I said" (skip remaining interview → straight to review with defaults), "Edit on web" (stash draft, deep-link to the web edit surface). Deep-link scheme is `mageid://` (`app.json`; single source `utils/deepLinkScheme.ts`).
- **Error surfacing** mirrors `mageAI.errorKind`: `timeout`/`network` → retry with the draft preserved; `monthly_cap`/`unauthenticated` → the existing paywall / sign-in copy; `validation` → keep the salvaged draft and flag the bad field. No silent catches (the `VoiceCaptureModal` no-silent-catch rule generalizes).
- **Client tier gate:** shell calls `useTierAccess().canAccess(capability.featureKey)` before opening; if blocked, route to `app/paywall.tsx`. **Usage meter:** `checkAILimit(tier, requestTier, capability.aiFeature)` before each *AI* turn, `recordAIUsage(requestTier, capability.aiFeature)` after — same contract `AICopilot.tsx` already uses. **Server gate:** the `feature` param on `mageAI` triggers `requireTier` server-side, so a forged client can't bypass the tier.

### 3.6 Phone/web synced data model

Both surfaces render the **same** engine (React Native + RN-web). Phone opens the capability from a mic FAB and leads with `VoiceCaptureModal`; web opens the same shell from a "+ New" / command bar and leads with a text input (voice is iOS-native only — `VoiceCaptureModal` already returns an on-web error, and the shell falls back to typing on web). Apply is identical on both because it goes through the shared context adders → `offlineQueue` → Supabase. A draft started on phone can be finished on web via the "Edit on web" escape (draft stashed the way `autoScheduleFromEstimate.stashDraft`/`takeDraft` already hand a draft between screens).

---

## 4. Capability map — specific per area

Each subsection is a concrete adapter: grounding signals → gap rules → 4–7 grounded example questions → output type (real `types/index.ts`) → apply path (real fn) → phone/web split → hooks to reuse.

### 4.1 Schedule (FLAGSHIP — deepest)

The scheduler is the most-built surface in the repo (`app/schedule-pro.tsx`, `app/schedule-wizard.tsx`, `utils/autoScheduleFromEstimate.ts`, `utils/scheduleAI.ts`, `utils/scheduleGenSchema.ts`, `utils/cpm.ts`, `utils/scheduleOps.ts`, plus 15+ schedule utils). It already generates with per-task `rationale` + `assumption` — the exact "explain and flag guesses" pattern the engine formalizes. This is why it proves the pattern.

- **Grounding signals:**
  - Linked estimate line items grouped by category with quantities + totals — `autoScheduleFromEstimate.buildEstimateSummary` already produces the `by-category` summary and a `categoryMap` (category → estimate item ids) so tasks tie spend to schedule.
  - Learned durations: past closed projects' schedules (task durations by phase/trade) via `projectMemory.retrieveRelevant` and `CostDatabase` crew-rate proxies (`CostBookEntry.personalRate` per `trade|unit`).
  - `Project.squareFootage`, `Project.quality`, `Project.type`, `Project.location` (weather-sensitivity + regional pacing).
- **Gap rules (ask only if unresolved):**
  - Project start date — ask only if `ProjectSchedule.projectStartDate` unset (the known `startDate` jump bug means we must NOT silently stamp today; ask). Otherwise state it.
  - Phasing/occupancy — ask only if quality/type implies a phased or occupied job and the estimate can't disambiguate (e.g. multifamily). Skip for a single-family gut.
  - Long-lead items — ask only if a large-$ category (cabinets, windows, steel) has no lead-time signal in memory.
  - Crew constraint — ask only if past jobs show a crew-size bottleneck for the heaviest category; else default from `crewSize` history.
  - Hard milestone/deadline — ask only if none derivable.
- **Grounded example questions (double-turn form):**
  1. "I'll start framing after foundation cures — 5 working days for framing, scaled from your last two 1,800 SF jobs. Sound right?"
  2. "Your cabinets line is $28k — that usually means a 4-week lead on your jobs. Should I add a procurement milestone before install?"
  3. "This is an occupied remodel by the quality tier — do you need it phased by area, or can trades overlap?"
  4. "No start date is set. Break ground Monday the 21st, or pick another day?" *(never auto-stamps today)*
  5. "Concrete's your heaviest category here — cap the pour crew at 3 like your Henderson job, or run 4?"
  6. "Roofing and site work are weather-sensitive — want a 2-day weather buffer like you carried last winter?"
- **Output type:** `ProjectSchedule` + `ScheduleTask[]` (`types/index.ts:456,751`), each task with `rationale`, `assumption`, `linkedEstimateItems`, `isCriticalPath`, `wbsCode` — exactly the `GeneratedTask` shape from `scheduleGenSchema.normalizeGeneratedTask`.
- **Apply path:** `generateScheduleFromEstimate(project, estimate)` builds the draft via `buildScheduleFromTasks`; `stashDraft`/`takeDraft` hand it to the **existing review screen** (`app/schedule-review.tsx`); commit calls `updateProject(id, { schedule })`. The interview *replaces the blind generation with a grounded one*, then reuses the whole review+apply tail unchanged.
- **Phone vs web:** phone = voice kickoff ("build me a schedule for the Patel bath") + the ≤4-question interview → review card. Web = same interview *then* full Gantt editing in `schedule-pro.tsx` (drag bars, re-link deps, level overloads) — structural edits stay on web.
- **Reuse:** `utils/scheduleAI.ts` serializer, `utils/cpm.ts`, `utils/floatExplain.ts`, `utils/levelingSummary.ts`, `scripts/validate-schedule-gen-schema.ts`, the `scheduleCopilot` meter (already in ship-check as `test:sched-copilot`).

### 4.2 Estimate

- **Grounding signals:** THE moat. `CostDatabase` from `buildCostDatabase` — per `trade|unit` `CostBookEntry` with `personalRate`, `suggestedRate`, `bidBias` (are you bidding low?), `variability`, and `confidence`. Plus `estimateCalibration.computeCalibration` (per-category over/under history) and `applyCalibration`. Material rates via `utils/materialDatabase.ts` / `lookupRate(db, trade, unit)`.
- **Gap rules:** ask a unit price **only** when the cost book has no entry or `confidence: 'low'` for that `trade|unit`; otherwise state `suggestedRate` with its basis. Ask quantity only when it can't be derived from takeoff/sqft. Ask markup only if it deviates from the project's `globalMarkup` default. Ask allowance-vs-firm only for selection categories (tile/fixtures/appliances → `isAllowance`).
- **Grounded example questions:**
  1. "Drywall's running $2.55/SF on your last 4 jobs (high confidence) — use that, or override?"
  2. "You've bid concrete 8% low historically — want me to nudge the pour line up to $6.40/SF?"
  3. "Tile isn't selected yet — carry it as a $12/SF allowance like you usually do?"
  4. "No cost history for spray foam — what did the sub quote per board-foot?"
  5. "Keep your standard 18% markup on this one, or adjust?"
- **Output type:** `LinkedEstimate` + `LinkedEstimateItem[]` (`types/index.ts:1036,1046`) with `unitPrice`, `bulkPrice`, `markup`, `lineTotal`, `csiDivision`, `isAllowance`.
- **Apply path:** `utils/estimateCommit.ts` `commitEstimatePatch` / `snapshotPatch` (undo-safe), then `updateProject(id, { linkedEstimate })`. Reuse `utils/estimator.ts`, `utils/estimateAssemblies.ts`, `hooks/useCustomAssemblies.ts`, `hooks/useEstimateCalibration.ts`.
- **Phone vs web:** phone = voice a rough scope ("kitchen: demo, 200 SF tile, new cabinets, rewire") → engine prices each line from the cost book and asks only the unpriced ones. Web = full grid edit + assembly editor (`components/AssemblyEditorModal.tsx`).

### 4.3 Daily Report

Highest-frequency, lowest-friction — a single spoken end-of-day log fans out to several systems. The multi-field parser already exists (`utils/voiceDFRParser.ts` `parseDFRFromTranscript`; `voiceActionParser.ts` `field_update` kind) — the engine wraps it in the grounded interview + confirm-back.

- **Grounding signals:** today's schedule tasks in progress (match `workProgress` chips to `ScheduleTask.title`), the project's active crews/subs (`ManpowerEntry`), yesterday's weather + open issues, recent `materialsDelivered`.
- **Gap rules:** ask **only** for a missing high-signal field — if the super said hours + tasks but no weather, and weather is auto-fetchable (`utils/weatherService.ts`), fill it silently. Ask about an issue/delay only if the tone implies one. Never ask about manpower if it was stated.
- **Grounded example questions:**
  1. "You mentioned framing at 80% — that's the task on today's critical path. Push it, or flag a delay?"
  2. "Pulled today's weather as 'Clear, 62°' — override?"
  3. "You logged 6 hours but didn't say a trade — put it under framing?"
  4. "Any issues or delays to note, or a clean day?"
- **Output type:** `DailyFieldReport` (`types/index.ts:1374`) — `manpower`, `workPerformed`, `workProgress[]`, `materialsDelivered`, `issuesAndDelays`, optional `incident`. Progress chips roll into the schedule.
- **Apply path:** `addDailyReport(report)` (ProjectContext:1868). `workProgress` chips also drive `updateProject` schedule progress. Reuse `utils/voiceDFRParser.ts`, `components/AIDailyReportGen.tsx`, `components/VoiceCaptureModal` `topicChecklist`.
- **Phone vs web:** overwhelmingly phone (end-of-day, on-site, one dictation). Web = review/publish the homeowner summary (`homeownerSummary`).

### 4.4 Change Orders

- **Grounding signals:** cost book for pricing added scope (`suggestedRate`), the project's `originalContractValue` for the new-total math, the schedule for `scheduleImpactDays`, and any linked estimate item for the base price of the changed scope.
- **Gap rules:** ask the amount only if not stated *and* not derivable from cost book × quantity. Ask schedule impact only if the added scope plausibly extends the critical path (derive a suggestion from `cpm`). Ask approvers only if the project has a configured approver list to prefill (`COApprover[]`).
- **Grounded example questions:**
  1. "Owner wants the heat-pump upgrade — your cost book puts that around $4,200 installed. Use that as the CO amount?"
  2. "This adds a rough-in — that's about 3 days on your critical path. Add 3 days schedule impact?"
  3. "Send to the same approver you used on CO #2 (the owner's rep), or someone else?"
  4. "New contract total would be $284,200. Confirm and draft the CO?"
- **Output type:** `ChangeOrder` + `ChangeOrderLineItem[]` (`types/index.ts:1123,1082`) — `changeAmount`, `newContractTotal`, `scheduleImpactDays`, `approvers`, `csiDivision`.
- **Apply path:** `addChangeOrder(co)` (ProjectContext:1530). Reuse `voiceActionParser` `co` kind, `components/AIChangeOrderImpact.tsx`, `app/change-order.tsx`.
- **Phone vs web:** phone = capture on-site when the owner asks for it. Web = approver routing, portal send/recall (`portalState`).

### 4.5 RFIs & Punch

Two thin, closely-related adapters (both already have `voiceActionParser` kinds `rfi` / `punch`).

- **RFI grounding:** past assignees per discipline ("you send steel questions to the SE"), linked drawing/task, typical `dateRequired` lead. **Gaps:** ask assignee only if discipline is ambiguous; ask urgency only if not implied. **Questions:** "Steel beam sizing — send to the structural engineer like last time?" / "Need this before framing starts Thursday — mark it urgent?"
  **Output:** `RFI` (`types/index.ts:2813`) — `subject`, `question`, `assignedTo`, `ballInCourt`, `dateRequired`, `linkedTaskId`. **Apply:** `addRFI(rfi)` (ProjectContext:2841, auto-numbers).
- **Punch grounding:** the project's plan sheets (offer a plan pin), assigned subs by trade, common locations from prior punch items. **Gaps:** ask trade only if not inferable; ask due date only if a walk deadline exists. **Questions:** "Loose light fixture in the master bath — assign to your electrician (Vega Electric)?" / "Pin it on sheet A-201 where you're standing?"
  **Output:** `PunchItem` (`types/index.ts:2053`) — `description`, `location`, `assignedSub`, `priority`, optional `planSheetId`/`pinX`/`pinY`, `linkedTaskId`. **Apply:** `addPunchItem` / `addPunchItems` (ProjectContext:2622/2635). Reuse `app/punch-walk.tsx`, `app/ai-punch.tsx`.
- **Phone vs web:** both are phone-dominant (walking the site). Web = batch triage, plan-pin adjustment.

### 4.6 Safety

- **Grounding signals:** the trade doing the work (drives PPE + hazards), past incidents on similar tasks, the project's active JHAs. Existing edge fns: `safety-generate-jha`, `safety-draft-incident`, `safety-detect-hazards`.
- **Gap rules:** for an incident, ask **only** the OSHA-recordability-determining fields not stated (`treatment` level → recordable classification; `OshaIllnessType`); auto-classify severity from description. For a JHA, ask nothing the trade + task already imply — generate steps/hazards/PPE and confirm.
- **Grounded example questions:**
  1. "Cut hand on rebar — did it need more than first aid? (That decides if it's OSHA-recordable.)"
  2. "I drafted the JHA for concrete pour — hard hat, gloves, eye protection, boots. Add fall protection for the edge work?"
  3. "Who was involved, and what's their role on the crew?"
- **Output type:** `SafetyIncident` (`types/index.ts:2183`) / `JobHazardAnalysis` (`types/index.ts:2112`) / `ToolboxTalk`.
- **Apply path:** `SafetyContext` adders (mirror to `mageid_*` safety tables). Reuse `utils/safety/*`, `scripts/validate-safety-*.ts`. **Tier:** `safety_management` (Business) + server `safety_ai` cap.
- **Phone vs web:** phone = incident capture the moment it happens. Web = OSHA 300 log, signatures.

### 4.7 Billing / Invoicing

- **Grounding signals:** the estimate line items already billed vs remaining (`InvoiceLineItem.sourceEstimateItemId` + `billedPercent` across prior invoices), the project's `paymentTerms` default, `retentionPercent` history.
- **Gap rules:** ask **only** what to bill and how much % complete per line — derive amounts from the estimate; don't ask terms/retention if the project already defaults them. `utils/invoiceBilling.ts` + `scripts/validate-invoice-billing.ts` already own the "already billed" math.
- **Grounded example questions:**
  1. "Bill the kitchen demo — you estimated it at $2,800 and haven't billed it. Bill the full amount?"
  2. "Drywall's 60% done per your schedule — bill 60% of that line ($1,530)?"
  3. "Net-30 with 10% retention like your other invoices on this job?"
- **Output type:** `Invoice` + `InvoiceLineItem[]` (`types/index.ts:1184,1148`). **Apply:** `addInvoice(invoice)` (ProjectContext:1611). Reuse `voiceActionParser` `invoice` kind, `app/bill-from-estimate.tsx`, `components/AIInvoicePredictor.tsx`.
- **Phone vs web:** phone = "bill them for the demo." Web = Schedule of Values, AIA pay app (`app/aia-pay-app.tsx`), Stripe pay-link.

---

## 5. Rollout order

Each after the first is a **thin adapter** (grounding + gaps + apply + review model) on the proven engine, with its own later spec/plan.

1. **Engine core + Schedule (flagship)** — build the registry, turn reducer, shared shell, confirm-back/review, and the Schedule adapter. Proves grounding, ask-only-when-unresolved, the double-turn, and reuse of the existing schedule review+apply tail. Ships the engine validators.
2. **Estimate** — highest moat payoff (cost book grounding); reuses `estimateCommit` apply + calibration.
3. **Daily Report** — highest frequency; wraps `voiceDFRParser`, fans out to schedule progress.
4. **Change Orders** — cost-book pricing + CPM schedule impact.
5. **RFIs / Punch** — two smallest adapters; both `voiceActionParser` kinds already exist.
6. **Safety** — Business-tier; wraps the three safety edge fns.
7. **Billing** — grounds on already-billed math; last because web is the natural home for SOV/AIA.

Rationale for order: prove depth first (Schedule), then moat (Estimate), then frequency (Daily Report), then descend by adapter thinness.

---

## 6. Testing

Repo convention (confirmed): **no jest.** Pure-fn validators in `scripts/validate-*.ts`, each a standalone `bun run` that asserts and `process.exit(1)` on failure, all `&&`-chained into `ship-check` in `package.json`. New validators to add (and wire into the `ship-check` chain):

- `scripts/validate-copilot-turn-reducer.ts` — drive the pure turn reducer (`utils/copilot/turnReducer.ts`) through a full transcript: START → UTTERANCE → AI_DRAFT → asking → CONFIRM → review → APPLY_OK; assert phase transitions, that `EDIT_TRANSCRIPT` re-feeds the draft, that CANCEL discards, and that error actions land in `error` with the draft preserved.
- `scripts/validate-copilot-ask-decision.ts` — the ask-only-when-unresolved core: feed drafts + grounding where a field IS resolved (high-confidence `CostBookEntry`, or user already stated it) and assert **no question is asked**; feed unresolved high-impact fields and assert **exactly one** double-turn question is asked; assert gaps below `askThreshold` are never asked and their grounded default is used; assert `MAX_QUESTIONS` hard-stops and remaining gaps fall to flagged defaults.
- `scripts/validate-copilot-gaps-schedule.ts`, `-estimate.ts`, `-daily-report.ts`, `-change-order.ts`, `-rfi-punch.ts`, `-safety.ts`, `-billing.ts` — one per capability's `gaps()` fn: assert the estimate gap-rule suppresses a priced line (cost book high confidence) and asks an unpriced one; the schedule gap-rule asks for start date only when unset and never auto-stamps today; the CO gap-rule derives amount from cost book × qty before asking; the billing gap-rule never re-bills a fully-billed line; the safety gap-rule asks the recordability-determining field. Pure functions over fixtures — no network.
- Extend `scripts/validate-ai-feature-gating.ts` / `validate-edge-security.ts` to cover each new capability's `aiFeature` meter bucket + `feature`→`requireTier` mapping.

The gap-rule fns and the reducer are **pure by design** precisely so this convention covers them without a test runner.

---

## 7. Non-goals / deferred

- **Grounded optioneering (P1):** presenting 2–3 grounded *alternatives* per decision ("fast-track: 12 weeks / cost-safe: 14") instead of a single default. The engine's `Gap.choices` field is shaped for it, but v1 states one default + confirm. Deferred to a follow-on spec.
- **Last-Planner automation (P2):** auto-generating pull-plan commitments/constraints into `app/last-planner.tsx` from the interview. v1 feeds the schedule; it does not drive the Last Planner board.
- **Full conversational STRUCTURAL editing on phone:** re-linking dependencies, bulk re-pricing, dragging bars by voice. Structural editing **stays on web** (`schedule-pro.tsx`, estimate grid) until a safe NL-edit subset is validated. v1 phone scope is CREATE + confirm + single-field correction only.
- **A stateful conversation server:** explicitly out. The turn loop stays client-side over the stateless `ai` relay.
- **Android/web voice capture:** iOS-native only in v1 (`VoiceCaptureModal` already gates this); web falls back to typing.

---

## 8. Open questions

1. **Optimal question budget before it annoys.** Is `MAX_QUESTIONS=4` and `askThreshold=0.35` right for a jobsite, or should it be dynamic per capability (Daily Report ~1–2, Schedule ~3–4)? Needs field validation.
2. **ASR robustness in 70–90 dBA noise.** The editable-transcript confirm mitigates it, but do we need a domain-biased vocabulary hint to the STT proxy (`transcribe-audio`) for trade terms and dollar amounts, or a "read the number back" confirm specifically for money fields?
3. **Where optioneering runs (P1).** When we add `Gap.choices`, do we compute alternatives client-side from the cost book, or add a heavier server pass? Affects the stateless-relay contract.
4. **Safe NL-edit subset for phone.** Which structural edits (if any) are safe to allow by voice on-site — e.g. "push framing 2 days" (bounded, reversible) vs. "re-sequence the whole MEP phase" (not)? Define the allowlist before any phone editing ships.
5. **Grounding freshness vs. cost.** `buildCostDatabase` is O(closed jobs). Do we build it once per session in `CopilotContext`, or cache per capability open? And do we embed project memory (`syncMemoryEmbeddings`, metered `project_memory`) eagerly or lazily on first schedule interview?
