# Scheduler — "The Schedule Builds Itself, and Explains Itself" (v1) — Design Spec

**Date:** 2026-07-02
**Status:** Approved design (user: "pull the copilot into v1, explainability moat lands"). Next: spec self-review → user gate → writing-plans.
**Thread:** Scheduler thread (thread B of the webapp/portal audit), reframed by deep research into a leapfrog play. Siblings queued: portal trust+engagement (approved, parked), webapp desktop-native polish.
**Backed by:** `docs/superpowers/` research synthesis (deep-research workflow `wf_1dc679a0-74e`, 19 verified claims).

---

## Problem

MAGE's scheduler already has **P6-grade depth** (real CPM: 4 dependency types, 8 constraints, float; named baselines, what-if scenarios, weather-driven reflow, EVM SPI/CPI, resource swimlanes + calendars, health score, voice-to-schedule, sub daily-updates). But the deep research is unambiguous about where the market actually breaks:

- **The core industry gap:** the schedule is a *disconnected artifact crews never use* — "massive spreadsheets, expensive consultants, a schedule no one in the field uses." ~75% of CPM schedulers are untrained in-house PMs; ~90% of those schedules "fail to serve their purpose."
- **Nobody owns both sides:** Primavera P6 / MS Project have CPM depth but no field usability (40-hr learning curve, dated UI); Touchplan / Last Planner tools have field love but **no CPM engine at all** (users keep a *separate* P6). SMB tools (Buildertrend deep-but-overwhelming, JobTread simple-but-shallow) have neither.
- **The AI vanguard's weak spot is explainability:** ALICE (generative optioneering) needs BIM and costs $50–150K/yr; nPlan (delay forecasting) is trained on 750K *large* projects; Planera "Manny" (Apr 2026) is the closest NL-copilot analog. Research explicitly flags **"missing explainability"** and fake-agentic marketing as the vanguard's soft underbelly. Adoption reality: ~45% of firms use *zero* AI; AEC trust in AI *fell* 80%→68% — so **AI must be embedded + explainable, not a scary premium bolt-on**, and specific ROI % must NOT be over-promised.

**MAGE's wedge:** it already owns the hard part everyone misses on *one* side — a real CPM engine AND field collaboration (sub daily-updates) AND the **estimate + cost data** that is the input ALICE needs BIM for. Crucially, the generative bridge **already exists**: `utils/autoScheduleFromEstimate.ts` → `generateScheduleFromEstimate()` already Claude-generates phased CPM tasks (durations, deps, milestones, critical-path, crew, WBS, category links; zod-validated) and is already metered via the `scheduleBuilder` AI feature key. What's missing is: (1) it produces tasks with **no reasoning**, (2) it's **not surfaced** as a first-class, reviewable hero experience, and (3) Tier-0 stubs (**undo/redo**, **drag-to-create-dependencies**) make an AI-built schedule frustrating to own.

## Goal

Make MAGE **the scheduler small/mid GCs actually use** by turning the existing generative engine into a trustworthy, explainable, editable hero: **one tap → a real CPM schedule built from your estimate, every task explaining *why* → refine it by talking to it.** Explainability is the moat competitors lack; human-in-the-loop review is what makes "works without BIM" true.

## Decisions (locked)

1. **Hero = generative "the schedule builds itself"**, elevated + made explainable + human-reviewable. **Extend** the existing `generateScheduleFromEstimate` / `scheduleEngine` / `scheduleAI` / `AIAssistantPanel` — do NOT rebuild.
2. **Explainability is the differentiator:** every generated task/phase carries a short **rationale**, surfaced in review and on tap; the copilot explains every change.
3. **NL copilot is IN v1** (extend `scheduleAI` + `AIAssistantPanel` + `VoiceCommandModal`): edit + what-if in plain English, always with reasons.
4. **Tier-0 core in v1:** undo/redo + drag-to-create-dependencies (the two that make an AI-built schedule ownable).
5. **Fast-follow (explicitly NOT v1):** explainable risk flags, side-by-side baseline compare, resource-leveling toggle, actuals/as-built UI, native mobile scheduler, multi-scenario generative optioneering, BIM.
6. **No over-promised ROI %** anywhere in UI/marketing; frame AI output as reasoned + reviewable, never as guaranteed savings.

---

## Architecture — units (each: what it does / how used / depends on)

### Unit 1 — Generative core, made explainable (`utils/autoScheduleFromEstimate.ts`)
- **What:** turns a project's `LinkedEstimate` (items grouped by category, with qty + lineTotal) into a phased CPM task list. **Already exists.**
- **v1 change:** extend `autoScheduleSchema` + the prompt so each task carries a **`rationale`** (1 sentence: sequencing reason + duration basis, e.g. *"Framing before drywall; 5 days from 1,800 SF at your crew's rate"*). Where the **cost DB / crew rates** give a defensible duration, use them and say so; where assumed, mark the task `assumption: true` so review can highlight it. Keep zod validation; keep category→estimate linkage.
- **Depends on:** `mageAI`, `scheduleEngine.buildScheduleFromTasks`, `LinkedEstimate`, cost DB / crew-rate lookups.

### Unit 2 — Review-and-refine draft experience (schedule generation flow)
- **What:** a first-class **"Build my schedule"** entry (from a project *with an estimate*) → progress state → a **review draft** screen where the GC can **accept / edit a task / regenerate a phase**, with each task's **rationale** visible on tap and **assumption** tasks flagged. Nothing is silently authoritative — the accept step is what makes no-BIM generation trustworthy.
- **How used:** entry from Schedule Pro empty-state + schedule-wizard + project detail. On accept → commit via existing `updateProject` / `buildScheduleFromTasks`, then land in Schedule Pro.
- **Depends on:** Unit 1, `schedule-wizard.tsx`, `schedule-pro.tsx`, CPM engine (recompute on edit).

### Unit 3 — NL copilot with reasons (`components/schedule/AIAssistantPanel.tsx` + `utils/scheduleAI.ts`)
- **What:** the existing "game-changer drawer" extended to **edit + answer what-if in plain English, always returning a reason** — *"push all electrical after rough-in inspection"* → applies the edit + explains critical-path impact; *"what if framing slips 3 days?"* → traces CPM, shows the finish-date effect, does NOT mutate until confirmed.
- **How used:** drawer in Schedule Pro (already mounted) + `VoiceCommandModal`. Edits flow through the same `onEdit` path the grid/Gantt use (so CPM re-runs + undo captures them — see Unit 4).
- **Depends on:** `scheduleAI`, `mageAI`, CPM engine, Unit 4 (undo), a new/again-metered AI feature key.

### Unit 4 — Undo/redo (`app/schedule-pro.tsx`)
- **What:** wire the **declared-but-unused** `history`/`future` refs into a real undo/redo stack. Every mutation (grid edit, Gantt drag, copilot edit, generation-accept) pushes a snapshot; undo/redo hotkeys + the existing toolbar buttons walk it. Bounded depth (e.g. 50).
- **Depends on:** the single mutation entry point (`onEdit`) so all edits are captured uniformly.

### Unit 5 — Drag-to-create-dependencies (`components/schedule/InteractiveGantt.tsx`)
- **What:** wire the **declared-but-never-called** `onDependencyCreate`: drag from a task bar edge to another bar draws a live link and creates the dependency (default FS, editable type/lag after). Reuse the existing `wouldCreateCycle` guard.
- **Depends on:** existing PanResponder infra, GridPane dependency model, CPM re-run.

---

## Data & state
- **`ScheduleTask`** gains `rationale?: string` and `assumption?: boolean` (distinct from the existing free-text `notes`). Persisted with the schedule (AsyncStorage + Supabase, via `updateProject`) — no new store.
- Generated schedules already link tasks → estimate categories (`linkedCategories`); keep for EVM.
- Undo/redo state is **in-memory only** (per session), not persisted.
- Copilot what-if is **preview-only** until confirmed (never mutates state on a question).

## AI usage / gating
- **Pro-gated** via `schedule_gantt_pdf` (unchanged).
- **Metering:** generation already routes through `checkAILimit('scheduleBuilder')` (smart tier, free lifetime cap 3). The copilot adds a feature key (reuse `scheduleBuilder` or add `scheduleCopilot`) so plan-tier caps apply consistently with the activation work; `recordAIUsage` on success only. Explainability adds tokens — acceptable; keep rationale to one sentence.

## Error handling
- **Generation:** empty/absent estimate → clear "add estimate line items first" (already throws); model/parse failure → fail to a friendly retry, never a broken half-schedule (zod gate); assumption-heavy drafts surface the flags rather than hiding them.
- **Copilot:** ambiguous request → ask a clarifying question, don't guess-mutate; what-if never mutates; every applied edit is undoable (Unit 4).
- **Undo:** bounded stack; redo cleared on a new edit; no-op safe at stack ends.
- **Drag-deps:** cycle attempt blocked by `wouldCreateCycle` with a toast; self-link ignored.

## Testing (repo has no jest — pure-fn `scripts/validate-*.ts` + manual)
- **Pure:** `autoScheduleSchema` accepts/rejects (rationale required); undo/redo reducer (push/undo/redo/bound/redo-clear); dependency cycle guard; copilot intent→patch mapping on fixtures. Wire into `ship-check`.
- **Manual (fresh Pro project w/ an estimate):** one-tap generate → review shows rationale + assumption flags → accept → lands in Schedule Pro; copilot "push electrical after rough-in" edits + explains; "what if framing slips 3 days" previews without mutating; undo reverts a copilot edit; drag between two bars creates a dependency and CPM re-runs; cycle drag is blocked.

## Non-goals (v1 — fast-follow / later)
Explainable per-activity risk flags; side-by-side baseline compare; resource-leveling toggle; actuals/as-built entry UI; native mobile scheduler; multi-scenario generative optioneering; BIM ingestion; ROI-percentage claims.
