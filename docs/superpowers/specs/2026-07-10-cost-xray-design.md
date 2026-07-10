# Cost X-Ray — Design Spec

**Date:** 2026-07-10
**Status:** Approved design → ready for implementation plan
**Tier:** Business
**Ship path:** OTA-safe (Deno edge-function detection + JS-only client; `expo.version` stable; no new native modules)

---

## 1. Overview

Cost X-Ray is a camera-driven **hidden-condition risk** feature. During a bid walkthrough of an older home, a GC scans rooms with the phone and MAGE flags the margin-killers they *can't* see — outdated electrical, suspect plumbing, structural movement, moisture — and prices each as a **probability-weighted contingency allowance on the contractor's own learned costs**, pinned to the exact photo, with a field-verify task attached. The output is a **GC-only "Hidden Conditions" contingency section** injected into the estimate, which the contractor reviews and edits before deciding what (if anything) the client sees.

### The wedge (honest framing)

"Snap a photo → get an estimate" is a solved, crowded market (Handoff, Togal, SimplyWise, Hover). Cost X-Ray does **not** compete there. Its differentiation is two-fold and both parts are hard to copy:

1. **Inversion:** it prices what the camera *can't* see (the repipe, the Federal Pacific panel) rather than the visible finishes everyone else counts. No competitor is positioned this way contractor-side at bid time.
2. **Personal cost moat:** the risk *price* comes from `buildCostDatabase` — this contractor's realized rates and variability — not a national cost book. A rival with the best vision model still cannot price *this* GC's remediation risk.

This is defensible-by-execution, not a new technical category. We position it as a differentiated feature of the MAGE bid workflow, not as an invention.

---

## 2. Goals / Non-Goals

### Goals (v1)
- Detect the **priceable core** of hidden-condition tells from ordinary phone photos: electrical, plumbing, structural, moisture.
- Price each detected tell as a probability-weighted allowance band `{low, expected, high}` using the contractor's learned costs.
- Pin every tell to its source photo (bounding box) and spawn a **field-verify** task.
- Produce a **GC-only** "Hidden Conditions" contingency section in the estimate that the GC reviews/edits/accepts line by line.
- Ship entirely OTA-safe (edge-function detection + client mapping; no new native code).

### Non-Goals (explicitly OUT of v1 — YAGNI)
- **Hazmat/era-abatement tells** (asbestos/popcorn, lead paint, vermiculite) — liability-sensitive; deferred.
- **Self-calibrating probability engine** — v1 uses static base probabilities; v1 *captures the linkage data* so v2 can recalibrate to the contractor's realized hit-rate.
- **On-device / offline AI inference** — detection runs on a cloud edge fn; capture is offline-capable but detection needs connectivity.
- **Homeowner-visible risk lines** — all X-Ray lines default `clientVisible: false`.
- LiDAR/3D capture, exterior scanning, and precise measurement of the tells.

---

## 3. User Flow

1. **Entry** (two entry points):
   - From the **estimate screen** — a "Scan for hidden costs" action.
   - From **Discover → Tools** — a "Cost X-Ray" navigation card.
2. **Capture** — room-by-room stills via `expo-image-picker` (camera). Each becomes a `ProjectPhoto` (GPS/timestamp). Capture works offline; photos queue.
3. **Detect** — on connectivity, photos post to the `analyze-photos` edge fn (`task: 'conditionRisk'`). Returns detected tells with bbox + confidence.
4. **Price** — client maps each tell → remediation assembly → probability-weighted band from `buildCostDatabase`.
5. **Review** — the GC sees one card per tell (photo + bbox, tell, confidence, rationale, priced band) and **accepts / edits / rejects** each. Nothing enters the estimate until accepted.
6. **Apply** — accepted tells become contingency `LinkedEstimateItem`s (in a "Hidden Conditions" section, `clientVisible: false`) + field-verify `PunchItem`s, written through `offlineQueue`.

---

## 4. Architecture & Components

All detection is server-side (OTA-safe Deno); all pricing/mapping/UI is JS-only client.

### 4.1 Entry points
- **Estimate screen** (`app/(tabs)/estimate/index.tsx`): add a "Scan for hidden costs" action that opens the Cost X-Ray capture flow for the current estimate/project.
- **Discover → Tools** (`app/(tabs)/discover/index.tsx`): add a `NavigationCard` (icon: `ScanLine` or similar Lucide) titled "Cost X-Ray", subtitle "Price the hidden conditions before you bid", routing to the Cost X-Ray screen. Gated by Business tier via `useTierAccess`; when locked, route to `paywall`.

### 4.2 Capture flow (new screen)
- New route, e.g. `app/cost-xray.tsx` (registered in `app/_layout.tsx`).
- Uses existing `expo-image-picker` (camera + library). No new native module.
- Each capture persists as a `ProjectPhoto` (existing type/flow: GPS, timestamp, tag `cost_xray`) via `offlineQueue`.
- Multi-photo, room-by-room. A running list shows captured frames. Offline: "X-Ray pending — N photos queued", detection deferred until online.

### 4.3 Detection — new `conditionRisk` task on `analyze-photos`
`supabase/functions/analyze-photos/index.ts` already multiplexes `task: 'punch' | 'dfr' | 'rfi' | 'triage' | 'receipt' | 'rooms'`. We add `'conditionRisk'`:
- Extend the task union + the request validation allow-list (currently lines ~56, ~277–278) to include `'conditionRisk'`.
- Add a `CONDITION_RISK_PROMPT` and wire it into the prompt selector (~lines 372–376).
- Model: **Gemini Flash** (cheap classification), JSON-mode / constrained decoding (existing pattern).
- Gating: `requireTier(req, ['business'], 'cost_xray')`; meter against `MONTHLY_CAPS` (align a new `cost_xray` cap with the existing photo/drawing vision caps). Master emails bypass (server `MASTER_EMAILS`), fail-open preserved.
- Images transported base64 in 32KB chunks (existing helper); per/total payload guards apply.
- Prompt intent: **classify era/defect tells, not visible finishes.** For each tell return the response schema below. Conservative — prefer omitting a tell to guessing; every tell is "possible … verify," never a diagnosis.

**Detection response schema (per photo):**
```ts
type ConditionTell = {
  category: 'electrical' | 'plumbing' | 'structural' | 'moisture';
  tell: string;                 // e.g. "2-prong ungrounded outlets", "galvanized supply line"
  bbox: { x: number; y: number; w: number; h: number }; // normalized 0..1
  severity: 'low' | 'med' | 'high';
  confidence: number;           // 0..1
  likelihoodOfChangeOrder: number; // 0..1 base probability of the condition
  remediationHint: string;      // free-text hint mapped to an assembly client-side
};
type ConditionRiskResult = { photoId: string; tells: ConditionTell[] };
```
The edge response is coerced through the existing `validateAndNormalize`-style defensive pattern (mirroring `analyze-takeoff`) so malformed model output can never crash the client.

### 4.4 Risk → price mapping (client, deterministic)
New pure module `utils/costXray.ts`:
- `mapTellToAssembly(tell): AssemblyRef | null` — maps a detected `tell`/`remediationHint` to an existing remediation `ASSEMBLY` (`constants/assemblies.ts`) or trade rate (`constants/laborRates.ts`). Unmapped tells → verify-only (no price).
- `priceTell(tell, costDb): PricedTell` — computes the allowance:
  - `expected = likelihoodOfChangeOrder × lookupRate(trade, unit).personalRate × qty`
  - `low / high` from that trade's learned `variability` band (`utils/costDatabase.ts` / `utils/estimateConfidence.ts`).
  - Thin history (low sample size) → fall back to catalog rate, **wider band, lower confidence flag**.
- `routeByConfidence(pricedTell): 'price' | 'verify-only'` — tells below a confidence threshold (constant, e.g. `0.55`) are routed to **field-verify only** (task, no dollar line).

### 4.5 Output data model (reuse + minimal extension)
- **`LinkedEstimateItem`** (`types/index.ts:1021`) gains optional fields:
  ```ts
  sourcePhotoId?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  band?: { low: number; expected: number; high: number };
  confidence?: number;
  tell?: string;
  category?: 'electrical' | 'plumbing' | 'structural' | 'moisture';
  isContingency?: boolean;
  clientVisible?: boolean;   // default false
  ```
- Accepted tells group into a **"Hidden Conditions" allowance section** of the `LinkedEstimate`, reusing the existing `ContractAllowance` / contingency concept (`types/index.ts:264`) — no new container type.
- Each accepted tell also spawns a **`PunchItem`** (`types/index.ts:2026`) as a field-verify task, linked to the source photo + bbox, note "verify before demo/order."
- **`EstimateRevision`** (`types/index.ts:118`) records a revision with reason `'xray'` for auditability.
- **v2 linkage capture (built in v1):** persist, per accepted tell, the tuple `{ tell, category, estimateItemId, projectId }` so that when a `ChangeOrder`/`Invoice` later posts for that trade, v2 can attribute realized cost back to the tell. v1 only *records*; it does not recalibrate.
- **Persistence:** all writes route through `offlineQueue.supabaseWrite` — never direct `supabase.from(...)`. One migration adds the new `LinkedEstimateItem` columns + the v2 linkage table. **Migration is written, not applied** (owner-gated; never `supabase db push`).

### 4.6 Review screen (trust engineered in)
Mirrors the scheduler's rationale/assumption pattern. One card per detected tell:
- The source photo with the `bbox` highlighted.
- Tell + `severity` + a **confidence chip**.
- The priced allowance band `{low, expected, high}` (or a "Field-verify" chip if routed verify-only).
- A plain-English **rationale** ("2-prong outlets → likely no ground → full-rewire allowance").
- Actions: **Accept** (adds line + verify task) · **Edit** (qty / price / probability) · **Reject** (dismisses; records dismissal as v2 signal).
- **Nothing is added to the estimate until the GC accepts.**

---

## 5. Error handling & edge cases
- **Offline:** capture succeeds (photos queue); detection shows "pending" and runs on reconnect. No offline AI inference is promised.
- **No tells found:** "No hidden-condition flags detected — a standard contingency is still recommended."
- **Low confidence:** routed to field-verify only (task, not a priced line).
- **Model malformed output:** coerced via the defensive normalize pattern; bad tells dropped, never crash.
- **Thin cost history:** catalog-rate fallback, wider band, explicit lower-confidence flag on the line.
- **Tier locked:** entry points route to `paywall`; server `requireTier` also enforces (defense in depth).
- **Master account / fail-open:** estimates still generate offline; master emails bypass tier + caps identically on client and server (keep `OWNER_EMAILS` / `MASTER_EMAILS` in sync).

---

## 6. Safety / liability
- Every tell is phrased "possible X — verify," never a diagnosis.
- No hazmat/abatement tells in v1.
- Field-verify tasks carry a "verify before demo/order" note so the number is always human-confirmed before it drives a commitment.

---

## 7. Tier & metering
- **Business** tier. Register the feature in the client tier-access layer (`hooks/useTierAccess.ts`) and gate the two entry points.
- Server: `requireTier(req, ['business'], 'cost_xray')` on the new task.
- Add a `cost_xray` monthly cap to server `MONTHLY_CAPS` (`supabase/functions/_shared/auth.ts`) and keep it aligned with the paywall `AI_LIMITS` table (`app/paywall.tsx`) and `utils/aiRateLimiter.ts`.

---

## 8. Testing
Repo has **no jest** — verification is pure-function validators wired into `ship-check`, plus `tsc` + lint.
- **`scripts/validate-cost-xray.ts`** (pure `node`), covering `utils/costXray.ts`:
  - `mapTellToAssembly` — known tells resolve to the right assembly/trade; unknown → null.
  - `priceTell` — `expected = P × personalRate × qty`; band widens with variability; thin-history fallback widens band + drops confidence.
  - `routeByConfidence` — below-threshold tells route to verify-only (no price).
  - Malformed detection payloads normalize without throwing.
- Wire `validate-cost-xray.ts` into the ship-check script.
- `npx tsc --noEmit` clean; `bun run lint` clean.

---

## 9. File map (created / modified)

**Created**
- `app/cost-xray.tsx` — capture + review screen.
- `utils/costXray.ts` — pure risk→price mapping (assembly map, band pricing, confidence routing, normalize).
- `scripts/validate-cost-xray.ts` — pure-fn validator.
- `supabase/migrations/<ts>_cost_xray.sql` — new item columns + v2 linkage table (**written, not applied**).

**Modified**
- `supabase/functions/analyze-photos/index.ts` — add `conditionRisk` task, prompt, validation, gating, response coercion.
- `types/index.ts` — extend `LinkedEstimateItem`; (no new container types).
- `app/(tabs)/discover/index.tsx` — add the "Cost X-Ray" Tools `NavigationCard` (Business-gated).
- `app/(tabs)/estimate/index.tsx` — add the "Scan for hidden costs" action.
- `app/_layout.tsx` — register the `cost-xray` route.
- `hooks/useTierAccess.ts` + `supabase/functions/_shared/auth.ts` + `app/paywall.tsx` — register the `cost_xray` feature + aligned caps.
- `scripts/ship-check` (or its runner) — include `validate-cost-xray.ts`.

---

## 10. Open assumptions
- The remediation-assembly coverage for the four v1 categories is sufficient in `constants/assemblies.ts`; where a tell has no matching assembly, it falls back to a trade-rate allowance or verify-only (no invented assemblies).
- Static base probabilities (`likelihoodOfChangeOrder`) come from the detection model per tell in v1; a small client-side floor/ceiling clamp keeps them sane. The learned dollar band — not the probability — is the v1 personalization.
- The confidence threshold (`~0.55`) is a tunable constant, revisited after real-photo testing.
