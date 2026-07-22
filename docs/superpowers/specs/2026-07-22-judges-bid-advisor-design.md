# JUDGES — Bid Advisor ("should I bid this, and at what price?") — Design

**Date:** 2026-07-22
**Status:** Approved (design); ready for implementation plan
**Branch target:** `claude/judges-bid-advisor` (off `main`)

## Goal

The sixth and final brain faculty: **JUDGES**. Before a contractor commits to a job, JUDGES answers two questions in one glance:

1. **Should I bid this?** — a go/no-go verdict: **Take it / Bid but hold firm / Walk away**, with a 0–100 fit score and the 2–3 strongest reasons for and against.
2. **At what price?** — a recommended bid range and the margin it yields, grounded in the contractor's **learned historical costs**, not a generic template.

This is the purest expression of the cost-learning moat: the one decision where knowing your *real* costs beats every competitor's national-average pricing. A filing cabinet can't tell you to walk away from a money-loser; a brain can.

## Positioning

Every other faculty (SEES / REMEMBERS / REASONS / FORESEES / REACTS) helps run a job already won. JUDGES fires *before* the commitment — the highest-leverage moment, where a wrong yes costs a whole season. It closes the brain anatomy.

## Design principle: deterministic engine, AI narration only

**Every number is computed by a pure, testable function. The AI never invents a figure.**

- The true cost, recommended bid range, margin, fit score, and verdict come from `utils/judges/*` pure functions over the contractor's real data.
- `mageAI` receives the *already-computed* structured verdict and writes only the human explanation ("your last 3 kitchens ran 9% over on tile — padded here").
- This keeps the money math deterministic, validator-testable, and impossible to hallucinate — the failure mode (an LLM inventing a bid price) that would burn a contractor's trust is structurally excluded.

## What JUDGES stands on (verified in code)

| Engine | File | Role in JUDGES |
|---|---|---|
| `buildCostDatabase(projects, commitments, receipts?)` → `lookupRate(db, trade, unit)` | `utils/costDatabase.ts` | Learned unit cost per `category`+`unit` with `confidence`, `bidBias`, `variability`, `jobCount`. **The moat.** Keyed on the same `category`/`unit` estimate line items carry. |
| `computeCalibration({projects, commitments})` | `utils/estimateCalibration.ts` | Per-category bid calibration ("you bid low on tile") → narration + range nudge. |
| `computeMarginRisk({project, changeOrders, commitments, invoices})` → `MarginRiskScore{score,band,factors,topFactors,hasBasis}` | `utils/marginRiskScore.ts` | Forward-looking margin-bleed factors → risk sub-score + risk drivers. |
| `computeLivingEstimate(...)` / realized margin | `utils/livingEstimate.ts` | Realized margin on past jobs → aggregate by `ProjectType` = "my kitchens realize 18%". |
| `mageAISmart(prompt, estimateSchema, cacheKey)` + `scopeQuestions` | `app/estimate-wizard.tsx`, `utils/scopeQuestions.ts` | Scope → drafted line-item estimate (the "describe it" input path). |
| `mageAI({prompt, tier, feature})` | `utils/mageAI.ts` | The verdict narration call. |
| `useTierAccess().canAccess(FeatureKey)` | `hooks/useTierAccess.ts` | Client gate. Add `bid_scoring` FeatureKey (Business). |
| `Lead` type | `types/index.ts:1510` | A not-yet-won job — one "pick existing work" input source. |
| `LinkedEstimate` / `LinkedEstimateItem{category,unit,quantity,unitPrice}` | `types/index.ts:1036` | Existing draft estimates — the other "pick existing work" source; the line-item shape the engine prices. |

The only genuinely-new data query is cross-project **crew capacity** ("am I booked solid in the job's window?").

## Architecture

Three layers, each independently testable.

### 1. Pure engine — `utils/judges/`

**`types.ts`** — the domain types:

```ts
export type Verdict = 'take' | 'hold_firm' | 'walk';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface PricedLine {
  category: string;
  unit: string;
  quantity: number;
  bidUnit: number;          // the estimate's own unit price
  learnedUnit: number | null; // lookupRate suggestedRate, or null if no history
  usedUnit: number;         // learnedUnit ?? bidUnit (what we costed at)
  lineTrueCost: number;     // quantity * usedUnit
  confidence: ConfidenceLevel; // from the cost-book entry, or 'low' if fallback
  fromHistory: boolean;
}

export interface BidDriver {
  kind: 'margin' | 'cost_confidence' | 'track_record' | 'capacity' | 'risk' | 'calibration';
  polarity: 'positive' | 'negative';
  weight: number;           // 0..1 contribution to the fit score
  detail: string;           // plain, number-bearing sentence
}

export interface BidVerdict {
  verdict: Verdict;
  fitScore: number;         // 0..100
  trueCost: number;         // Σ lineTrueCost
  recommendedLow: number;   // bid range
  recommendedHigh: number;
  recommendedMid: number;
  marginAtMid: number;      // 0..1 fraction
  targetMargin: number;     // the margin target used
  bidBiasNudge: number;     // >0 = range nudged up because you habitually bid low
  costConfidence: ConfidenceLevel; // exposure-weighted across lines
  coveragePct: number;      // share of $ costed from real history (cold-start signal)
  lines: PricedLine[];
  drivers: BidDriver[];     // ranked, both polarities
  disclaimers: string[];    // e.g. cold-start note
}
```

**`priceLines.ts`** — `priceLines(lines, costDb): PricedLine[]`. For each line, `lookupRate(costDb, category, unit)`; use `suggestedRate` when present (`fromHistory=true`), else fall back to the line's `bidUnit` (`confidence:'low'`, `fromHistory:false`). Pure.

**`capacityLoad.ts`** — `computeCapacityLoad(projects, windowStartISO, windowEndISO): { loadPct: number; bookedSolid: boolean; overlappingProjects: number }`. Sweeps active (non-closed) projects' `schedule.tasks`, converts each task's `startDay`/`durationDays` against `schedule.startDate` to calendar dates, sums committed task-days that intersect the window, divides by working-day capacity in that window. `bookedSolid` when `loadPct >= 0.85`. Pure over `Project[]`.

**`typeMargin.ts`** — `aggregateTypeMargin(closedProjects, type, commitments): { avgMarginPct: number | null; jobCount: number }`. Iterates closed projects of the same `ProjectType`, reads realized margin (via the living-estimate/actuals path), returns the average and sample count. `null` avg when no history. Pure.

**`computeBidVerdict.ts`** — the orchestrator. `computeBidVerdict(input): BidVerdict`:

```ts
export interface BidVerdictInput {
  lines: { category: string; unit: string; quantity: number; bidUnit: number }[];
  costDb: CostDatabase;
  calibration?: CalibrationResult;      // computeCalibration output (optional)
  marginRisk?: MarginRiskScore;         // when a project shell exists (optional)
  capacity?: { loadPct: number; bookedSolid: boolean };
  typeMargin?: { avgMarginPct: number | null; jobCount: number };
  targetMargin: number;                 // contractor default markup → margin, e.g. 0.20
}
```

Steps: (1) `priceLines` → `trueCost`, exposure-weighted `costConfidence`, `coveragePct`. (2) Bid range = `trueCost / (1 - targetMargin)` for the midpoint; low/high = a ±spread band; `marginAtMid` back-computed. (3) `bidBiasNudge`: if the exposure-weighted `bidBias` is positive (habitually bids low), raise the range and record the nudge magnitude. (4) Five weighted sub-scores → `fitScore`: cost-confidence, margin headroom at mid, track record (`typeMargin`), capacity fit, risk (`1 - marginRisk.score/100`). Missing inputs drop out and re-normalize weights. (5) `verdict` bands the score: `>=70 take`, `45–69 hold_firm`, `<45 walk`. (6) `drivers`: build positive/negative `BidDriver`s from each sub-score + calibration, rank by `weight`. (7) `disclaimers`: cold-start note when `coveragePct` is low.

### 2. Client orchestrator — `utils/judges/runJudges.ts`

Gathers inputs and calls the engine (mirrors `utils/plans/askYourPlans.ts`):

- **Describe path:** takes scope answers → `mageAISmart(buildPrompt, estimateSchema, scopeCacheKey)` (reused from the estimate wizard) → line items → engine.
- **Pick path:** takes an existing `LinkedEstimate` or `Lead` (with its estimate) → line items → engine.
- Builds `costDb` via `buildCostDatabase(projects, commitments)`, `calibration` via `computeCalibration`, `capacity` via `computeCapacityLoad` over the timeline window, `typeMargin` via `aggregateTypeMargin`.
- Calls `computeBidVerdict`, then `narrateVerdict(verdict)` → `mageAI({prompt, tier:'smart', feature:'bid_scoring'})` for the human "why" (best-effort; a narration failure degrades to the engine's own driver sentences, never blocks the verdict).

### 3. UI — `app/judges.tsx` + `components/judges/`

- **`app/judges.tsx`** — the screen. Home state: "Judge a new job" (scope box + 🎤 `VoiceFieldButton`) **or** "Judge existing work" (picker over draft estimates + Leads). Business-gated via `canAccess('bid_scoring')` with the standard paywall CTA.
- **`components/judges/VerdictCard.tsx`** — the result: verdict pill (semantic color: green take / amber hold / red walk), fit score, recommended range + true cost + margin-at-mid, ranked driver chips (positive/negative), a `ConfidenceLevel` badge, and the cold-start disclaimer when present.
- **`components/judges/BidDriverRow.tsx`** — one driver line (icon by `kind`, polarity color, the detail sentence).
- Entry points: the Construction-AI hub (`app/(tabs)/construction-ai` or the AI tools list), a home entry near Brain Watch, and a "Judge this" action on a Lead. Route `/judges`, optional params `?leadId=` / `?estimateId=` to deep-link the pick path.

## Data flow

```
describe: scope → mageAISmart(estimateSchema) ─┐
pick:     LinkedEstimate | Lead.estimate ──────┤→ lines[]
                                                │
buildCostDatabase(projects, commitments) ──────┤→ costDb
computeCalibration(...) ───────────────────────┤→ calibration
computeCapacityLoad(projects, window) ─────────┤→ capacity
aggregateTypeMargin(closed, type) ─────────────┤→ typeMargin
computeMarginRisk(...) (if project shell) ─────┘→ marginRisk
                          ↓
             computeBidVerdict(input) → BidVerdict   (pure, deterministic)
                          ↓
             narrateVerdict → mageAI(feature:'bid_scoring')  (phrasing only, best-effort)
                          ↓
                    VerdictCard
```

## Tier gating & cold-start

- **Tier: Business.** New `bid_scoring` FeatureKey → Business in `hooks/useTierAccess.ts`. It's a flagship intelligence faculty and leans on closed-job history.
- **Cold-start (little/no history):** the engine still runs. Lines with no cost-book entry fall back to the estimate's own price (`confidence:'low'`, `fromHistory:false`). When `coveragePct` is low, a disclaimer is emitted: **"Based on your bid assumptions, not yet your history — this sharpens as you close jobs."** Honest instead of confidently wrong.

## Error handling

- Cost-book / calibration / capacity / type-margin computations are wrapped best-effort; any single failure drops that input and re-normalizes the fit-score weights (the pattern `estimateGrounding.ts` already uses).
- `mageAISmart` estimate draft failure surfaces a retry ("couldn't read that scope — rephrase or add detail"); the engine never runs on empty lines.
- `narrateVerdict` failure degrades to the engine's own `driver.detail` sentences — the verdict + numbers always render.
- The engine is total: empty lines → `trueCost 0`, `verdict 'walk'` with a "no scope to price" disclaimer, never a throw.

## Testing (no jest — pure-fn validators in ship-check)

New `scripts/validate-*.ts`, each wired into the `ship-check` `&&`-chain (convention: relative imports, tiny `ok(name,cond)` harness, footer exit-on-fail):

- **`validate-judges-verdict.ts`** — pricing (history vs fallback), `coveragePct`, exposure-weighted confidence, range math + `marginAtMid`, `bidBiasNudge` direction, fit-score weight re-normalization when inputs missing, verdict thresholds (70/45), driver ranking + polarity, empty-lines totality, cold-start disclaimer.
- **`validate-judges-capacity.ts`** — window intersection, `loadPct`, `bookedSolid` threshold, closed-project exclusion, no-schedule projects → 0 load.
- **`validate-judges-type-margin.ts`** — averaging, type filtering, null when no history, sample count.

`npx tsc --noEmit` clean; `bun run lint` 0 errors; anti-slop (Colors/Type/Tokens — no raw hex / inline fontSize / borderRadius).

## Ship boundary

- **OTA-safe:** the engine + orchestrator + UI are pure JS/TS and reuse the existing `ai` relay for narration → shippable via `eas update` with no native build.
- **Client-gated for MVP:** `canAccess('bid_scoring')` gates the screen; the money math runs on the contractor's own local data; narration reuses the existing authenticated relay.
- **Owner-gated hardening (follow-up):** a dedicated `bid-judge` edge function with server-side `requireTier(['business','enterprise'], 'bid_scoring')` + a `MONTHLY_CAPS` entry, so the premium gate is enforced server-side (same pattern as `plan-extract` for Ask Your Plans). Not required for the MVP to function.

## Out of scope (v2+)

- Win-probability modeling / competitor-price intelligence.
- Auto-submitting a bid or generating the proposal document (JUDGES advises; the estimate/proposal flow already exists).
- Server-side enforcement + monthly cap (owner-gated follow-up above).
- Learning from bid *outcomes* (won/lost at price X) to calibrate the recommendation — a strong v2 once Leads capture outcomes.
- Multi-crew/skill-specific capacity (v1 treats capacity as aggregate schedule load).

## Files

- **Create:** `utils/judges/types.ts`, `utils/judges/priceLines.ts`, `utils/judges/capacityLoad.ts`, `utils/judges/typeMargin.ts`, `utils/judges/computeBidVerdict.ts`, `utils/judges/narrateVerdict.ts`, `utils/judges/runJudges.ts`
- **Create:** `scripts/validate-judges-verdict.ts`, `scripts/validate-judges-capacity.ts`, `scripts/validate-judges-type-margin.ts`
- **Create:** `app/judges.tsx`, `components/judges/VerdictCard.tsx`, `components/judges/BidDriverRow.tsx`
- **Modify:** `hooks/useTierAccess.ts` (add `bid_scoring` FeatureKey → Business), `package.json` (3 validators into ship-check), `app/_layout.tsx` (register `/judges` route), a Construction-AI hub entry + home entry + Lead action (nav wiring)
- **Reference (reuse, unchanged):** `utils/costDatabase.ts`, `utils/estimateCalibration.ts`, `utils/marginRiskScore.ts`, `utils/scopeQuestions.ts`, `utils/mageAI.ts`
