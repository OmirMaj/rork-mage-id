# Price Takeoff → Estimate — Deep Technical & Product Review

**Date:** 2026-07-07
**Scope:** The quantity-takeoff-to-pricing pipeline in MAGE ID.
**Verdict:** Two half-built takeoff systems that don't share a pricing brain. One (AI PDF) has no user-controlled measurement; the other (visual trace) has real measurement but a cold-start pricing dead-end. The app's richest asset — the deterministic regional pricing engine in `constants/materials.ts` — is wired to *neither* takeoff path. That's why it feels underdeveloped.

---

## 1. Current state — the full pipeline

There is not one takeoff feature. There are **two parallel, largely disconnected systems**, plus a third pricing engine that neither uses.

### System A — AI PDF Takeoff (the "hero" path)
`app/takeoff.tsx` → `utils/pdfRenderClient.uploadAndRenderPdf` → `supabase/functions/analyze-takeoff/index.ts` → `app/takeoff-estimate.tsx`

- **Input:** User uploads a drawings PDF (`app/takeoff.tsx:188` `DocumentPicker`). Pages are rendered to PNG URLs and handed to the edge function (`app/takeoff.tsx:211`, `:225`).
- **Extraction:** `analyze-takeoff/index.ts` sends the page images to a vision LLM (Gemini 2.5 Flash / Pro / Claude Sonnet by tier, `analyze-takeoff/index.ts:61-74`). The prompt (`buildPrompt`, `:126-317`) asks the model to *read* the printed scale, trace room outlines, read dimension strings, and read door/window/finish schedules. Output is a structured `TakeoffResult` (walls LF, floor SF, door/window/fixture counts, bulk materials) with per-row `confidence` + `sourcePages`, hardened by `validateAndNormalize` (`:558-738`).
- **Pricing:** `app/takeoff-estimate.tsx` loads the saved takeoff (`:132 loadTakeoff`) and asks the AI *again* to turn quantities into priced CSI line items. The pricing prompt (`buildPricingPrompt`, `:639-725`) passes the location only as a free-text string (`:167 settings.location`) and instructs the model: *"Use REALISTIC current US installed unit costs… If you don't know a regional rate, use a national-average rate"* (`:720-721`). **The unit prices are invented by the LLM.**
- **Assembly → estimate:** Cleaned lines (`:184-194`) → `LinkedEstimate` saved via `commitEstimatePatch` (`:307`). Totals are computed locally: `subtotal = Σ qty×unitPrice`, `+ global markup` (`:207-215`).

### System B — Visual / Area Takeoff (real measurement)
`app/area-takeoff.tsx` + `utils/takeoffGeometry.ts` + `utils/takeoffEstimate.ts` + `utils/costDatabase.ts`

- **Input:** A plan image or a saved project plan sheet (`app/area-takeoff.tsx:143` image picker, `:75 getPlanSheetsForProject`).
- **Calibration:** User taps two points and enters the real distance → feet-per-pixel (`area-takeoff.tsx:221`, `takeoffGeometry.ts:32 feetPerPixel`). Calibration is persisted per sheet (`upsertPlanCalibration`, `area-takeoff.tsx:226`) and **reused** across sessions/screens (`:156 getCalibrationForPlan`).
- **Measurement:** User traces a polygon/polyline → real quantities via the shoelace formula (`takeoffGeometry.ts:polygonAreaSqFt :52`, `polylineLengthFt :74`, `polygonPerimeterFt`). This is **genuine on-screen quantity takeoff.**
- **Pricing:** `priceTakeoff` (`takeoffEstimate.ts:32`) looks the trade+unit up in the user's **own** cost database (`costDatabase.ts buildCostDatabase :80`), which is distilled from closed-job bid-vs-actual ledgers with a cold-start blend (`w = n/(n+K)`, `costDatabase.ts:176-177`) and a variability band → honest low/high range.
- **Assembly → estimate:** `handleAddToEstimate` (`area-takeoff.tsx:253`) appends one priced line to an *existing* `project.linkedEstimate`.

### System C — the deterministic pricing engine (used by neither takeoff)
`constants/materials.ts` — powers only the manual Materials picker tab `app/(tabs)/estimate/index.tsx`.

- ~300 base SKUs with retail/bulk prices (`BASE_MATERIALS:24+`), expanded across 12 regions × pricing tiers × assembly factors into `EXPANDED_MATERIALS` (`:441-497`).
- Regional multipliers (`REGIONAL_FACTORS:410`), keyword-matched from free-text location (`getRegionMultiplier:506`), applied in `getLivePrices:533`.
- Per-category labor/equipment factors + install hours (`CATEGORY_COST_FACTORS:334`, `getMaterialCostBreakdown:354`), waste factors per tier (`PRICING_TIERS:431`), and true material *assemblies* with `materialsPerUnit`/`laborPerUnit`/`wasteFactor` consumed in `(tabs)/estimate/index.tsx:540-547`.
- The Estimate tab correctly applies location: `getRegionMultiplier(settings.location)` (`index.tsx:158`).

---

## 2. Assessment (evidence-based)

### Is this REAL quantity takeoff or shallow?
**Both, split across the two systems — and the deep half is hidden.**

- **System A (AI PDF) is shallow-by-measurement.** There is *no user-controlled scale calibration or on-screen measurement.* The model is asked to read the printed scale and dimension strings itself (`analyze-takeoff:138-146`). If a dimension isn't printed, the model interpolates "against the scale" or guesses (`:151-153`) — i.e. it eyeballs. Accuracy is entirely at the mercy of scan resolution and the LLM. There is no way for the estimator to verify a length by measuring it on the sheet; they can only override the AI's number in a text field (`takeoff-estimate.tsx overrides`).
- **System B (visual trace) is real takeoff** — scale calibration + shoelace geometry (`takeoffGeometry.ts`). This is the genuinely competitive capability, and it's the *less* prominent of the two (gated behind `job_costing`, `area-takeoff.tsx:60`).
- **The scale calibration is disconnected from the AI path.** `plan-viewer.tsx` has a full measure/calibrate UI (`MIN_CALIBRATION_PX:48`, `measuredFt:173`) but `measuredFt` is **display-only — never saved into a takeoff** (grep shows it's only rendered, `:465/:475/:532`). And `analyze-takeoff` never receives the user's calibrated scale at all. So the app has three separate notions of "scale" (AI-read, plan-viewer ephemeral, area-takeoff persisted) that don't feed each other.

### How deep is the pricing?
- **System A pricing is the weakest link: pure LLM invention.** No lookup against `materials.ts`, no waste factor, no unit conversion, no assembly logic beyond whatever the model chooses to bundle (`buildPricingPrompt:718`). Location is a text hint only. Two runs can return different prices; numbers aren't reproducible or auditable.
- **System C is genuinely deep but unreachable from takeoff.** It has regional multipliers, labor+material+equipment split, waste factors, and assemblies — everything an estimator wants — but it only prices the manual Materials picker. **The takeoff quantities and the real pricing engine never multiply together.** This is the single biggest structural gap.
- **System B pricing is smart but cold-start-blocked.** It prices from the GC's own history, which is empty until jobs close. Worse: `handleAddToEstimate` is fully gated behind `pricing?.matched` (`area-takeoff.tsx:254`) with **no manual-rate fallback** — a new user can measure a real quantity but literally cannot price it or add it to an estimate (`:473` just tells them to open it from a project). And it only *appends* to an existing `linkedEstimate` (`:254`), so you can't start an estimate from a visual takeoff.
- **No waste factor on measured quantities.** `handleAddToEstimate` uses raw net traced area: `lineTotal = qty * pricing.rate` (`:257`). Floor SF from the AI is explicitly *net interior* (`analyze-takeoff:141`), yet nothing adds cut/waste allowance downstream. Flooring priced at net area under-buys every time.

### Would an estimator trust these numbers?
- **System A:** No, not without checking every line. AI-read quantities *and* AI-invented prices means two stacked hallucination surfaces. The `confidence`/`sourcePages` machinery (`analyze-takeoff:150-160`) is good and honest, but "trust but verify everything" is not a takeoff tool — it's a first draft.
- **System B:** Yes, for the trades they have history in — the low/high band and job-count disclosure (`area-takeoff.tsx:461`) is exactly right. But coverage is thin until many jobs close.
- **Rounding:** counts and linear feet are rounded at add time (`area-takeoff.tsx:256`); fine. AI quantities aren't reconciled against each other (e.g. wall LF vs. perimeter vs. floor area) — no geometric cross-check.

### Web vs iOS parity
- System A is web-capable: PDF upload + edge function are platform-neutral; only haptics are gated (`takeoff.tsx:209`). Good parity.
- System B: `area-takeoff` uses `react-native-svg` + `GestureResponder` taps + `expo-image-picker`, all of which run on web, and haptics are guarded (`:180`). Reasonable parity, though touch-tracing precision on desktop (mouse) vs. finger differs and isn't tuned.
- `plan-viewer` measurement similarly web-capable. No native-module blockers in the takeoff stack — everything is OTA-updatable today.

### Why it feels underdeveloped — concretely, what an estimator can't do
1. Can't **measure on the AI-read plan to verify** a suspicious quantity (calibration exists but doesn't feed the AI takeoff).
2. Can't get **reproducible, auditable prices** on an AI takeoff — they're LLM guesses, not a priced database.
3. Can't **price a visual takeoff at all without closed-job history** (no manual rate, no fallback to `materials.ts`).
4. Can't **start an estimate from a takeoff** in System B (append-only), and can't push System A takeoff quantities through the real pricing engine.
5. Can't apply **waste/labor factors** to measured quantities — net area flows straight to a lump price.
6. No **assemblies from a takeoff** (e.g. "1 LF exterior wall → studs + sheathing + WRB + insulation + drywall" with quantities), even though the assembly data model exists in System C.
7. No **count/symbol auto-detection**, no **length auto-trace**, no **on-sheet measurement history/markup layer** that persists with the estimate.

---

## 3. Benchmark vs. category leaders

| Capability | PlanSwift / STACK / Bluebeam / Togal | MAGE ID today |
|---|---|---|
| On-screen scale calibration | Core, per-sheet, multi-scale | Exists (System B + plan-viewer) but not fed to the AI path |
| On-screen area/linear/count measurement | Core, with snapping | System B only (shoelace, no snapping), gated behind a tier |
| AI auto-quantity | Togal/newer STACK | System A (strong extraction, honest confidence) — ahead of many |
| Assemblies / kits (1 measured qty → many priced items) | Core (PlanSwift "assemblies") | Data model exists in System C; **not wired to takeoff** |
| Waste & labor factors | Core | In System C; **not applied to takeoff quantities** |
| Real pricing database | RSMeans / supplier feeds | National seed + regional multiplier (System C) *or* your-own-actuals (System B) — good ingredients, unreachable from takeoff |
| Estimate export (PDF/XLSX) | Core | LinkedEstimate → estimate PDF exists |
| Cost-learning from actuals | Rare | **System B is genuinely ahead** — a real differentiator |

**Grounded takeaway:** MAGE's *extraction* (AI PDF) and its *cost-learning* (your-own-actuals) are competitive-to-ahead. Its *measurement-verification* and *assembly/waste pricing* are behind, and its own good pricing engine is stranded from the takeoff.

---

## 4. Recommended build-out (prioritized, build-ready)

All items below are **JS-only / OTA-safe** — the takeoff stack uses `react-native-svg`, `expo-document-picker`, `expo-image-picker`, and edge functions, none of which need a new native module. No OTA-breaking work is required for P0–P1. (Flag: only a future "hi-fi PDF pan/zoom canvas with snapping" might justify a native gesture/canvas module — call it out at P2.)

### P0 — Wire the real pricing engine into takeoff (highest value, ~2–4 days)
The quantities and the prices already exist; they just never meet.
- **Add a deterministic pricing fallback to System A.** Before/alongside the AI pricing call in `app/takeoff-estimate.tsx`, map each takeoff row (wall/floor/finish/door…) to `materials.ts` categories and price via `getLivePrices(seed, getRegionMultiplier(settings.location))` (`constants/materials.ts:506,533`). Show AI price and engine price side by side; let the estimator pick. Touches: `app/takeoff-estimate.tsx`, `constants/materials.ts` (add a `takeoff→category` mapper), maybe a new `utils/takeoffPricing.ts`.
- **Give System B a manual-rate fallback.** When `priceTakeoff` returns `matched:false`, let the user type a rate *or* pull the `materials.ts` regional rate, then allow Add-to-estimate. Removes the cold-start dead-end. Touches: `app/area-takeoff.tsx:253-286`, `utils/takeoffEstimate.ts`.
- **Apply waste factors to measured quantities.** Multiply traced SF/LF by category waste (reuse `PRICING_TIERS.wasteFactor` / assembly `wasteFactor`, `materials.ts:432-434,470`) before pricing. Touches: `app/area-takeoff.tsx:257`, `app/takeoff-estimate.tsx`.

### P1 — Close the measurement/calibration loop (~1 week)
- **Feed calibration to the AI takeoff.** Persist `plan-viewer`'s `measuredFt`/calibration into the takeoff, and pass the calibrated feet-per-pixel + a couple of known reference dimensions into `analyze-takeoff` as ground truth so the model scales to *your* calibration instead of reading the printed scale blind. Touches: `app/plan-viewer.tsx` (save measurement), `supabase/functions/analyze-takeoff/index.ts:126` (accept `scaleHint`), `utils/takeoffAnalyzer.ts`.
- **"Verify on sheet" from an AI takeoff row.** From any `takeoff-estimate` line, jump to `plan-viewer`/`area-takeoff` on the cited `sourcePages` to measure and overwrite the AI number. Closes the trust gap. Touches: `app/takeoff-estimate.tsx`, `app/plan-viewer.tsx`, `app/area-takeoff.tsx`.
- **Assemblies from takeoff.** Turn one measured/AI quantity into a priced kit (wall LF → framing+sheathing+WRB+insulation+GWB) using the existing assembly model in `(tabs)/estimate/index.tsx:540`. Touches: new `utils/takeoffAssemblies.ts`, `app/takeoff-estimate.tsx`.
- **Let System B start an estimate,** not just append (create a `linkedEstimate` if none exists). Touches: `app/area-takeoff.tsx:254`.

### P2 — Depth & accuracy hardening (~2–3 weeks)
- **Geometric cross-checks** on AI output (floor perimeter vs. wall LF; envelope vs. sum of rooms) surfaced as `concerns`. Touches: `analyze-takeoff/index.ts:validateAndNormalize`.
- **Deeper regional pricing:** move `getRegionMultiplier` from keyword-match (`materials.ts:506`) to ZIP/metro-level factors; optionally a supplier-price edge function refresh. Touches: `constants/materials.ts`, new edge fn.
- **Measurement UX:** ortho/snap, count-symbol templates, persistent on-sheet markup layer stored with the estimate. **This is the one place** a native high-performance canvas/gesture module *might* be considered — evaluate whether `react-native-svg` + Reanimated suffices first to stay OTA-safe.
- **Unit-test the geometry + pricing** (repo has no jest — follow the memory note and validate pure fns in `takeoffGeometry.ts`, `takeoffEstimate.ts`, `takeoffPricing.ts` with `validate-*.ts` scripts).

---

## 5. Files map (for the implementer)

- Extraction: `supabase/functions/analyze-takeoff/index.ts`, `utils/takeoffAnalyzer.ts`, `utils/pdfRenderClient.ts`, `app/takeoff.tsx`
- AI pricing: `app/takeoff-estimate.tsx` (esp. `buildPricingPrompt:639`)
- Visual takeoff: `app/area-takeoff.tsx`, `utils/takeoffGeometry.ts`, `utils/takeoffEstimate.ts`, `utils/costDatabase.ts`
- Calibration: `app/plan-viewer.tsx` (`MIN_CALIBRATION_PX:48`, `scaleFtPerPx:164`), `ProjectContext` (`getCalibrationForPlan`/`upsertPlanCalibration`)
- Pricing engine (unreached): `constants/materials.ts`, consumed in `app/(tabs)/estimate/index.tsx`
- Wizard (separate, AI-priced): `app/estimate-wizard.tsx`, `utils/scopeQuestions.ts`
- Storage/assembly: `utils/takeoffStorage.ts`, `utils/estimateCommit.ts`, `types/index.ts` (`TakeoffResult`, `LinkedEstimate`)
