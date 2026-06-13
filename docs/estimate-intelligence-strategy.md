# Estimate Intelligence & Visual Takeoff — Strategy

Date: 2026-06-07
Status: living strategy doc (Build A shipped, Build B started)
Scope: the estimate-accuracy cost-learning loop + the lasso-an-area visual takeoff

---

## Thesis

> **"Your prices, learned from your jobs."**

Two features that look separate are actually two halves of one moat:

1. **Estimate accuracy** — a self-learning cost database fed by your own job actuals.
2. **Visual takeoff** — lasso an area on a plan/photo → instant quantity → price.

Every competitor does *one* of these, priced off *generic* data, in a *separate
product*. **Nobody closes the loop** — because their takeoff, estimating, and
job-cost actuals live in different apps (or they have no actuals at all). MAGE
already owns estimate → buyout → `commitment.linkedEstimateItems` → actuals →
margin in **one app with the line-item↔commitment linkage** the rest of the
industry never built. That linkage is the unfair advantage a rival can't bolt on.

---

## The problem (why this matters)

The estimate→actual gap is the central unsolved pain in GC software, not takeoff speed:

- **~28% average cost overrun; 9 of 10 projects blow budget.** ([fullclarity](https://fullclarity.com/construction-cost-overruns-causes-and-fixes/))
- **95% of construction data goes unused** across disconnected systems (McKinsey, via [crewcost](https://crewcost.com/blog/mastering-construction-job-costing/)).
- **52% of rework traced to the estimate→execution handoff** (FMI, via [projul](https://projul.com/blog/construction-estimating-operations-handoff-guide/)).
- Contractors stay on Excel because they fear "software making assumptions" — **trust, not features, is the adoption blocker.** ([estimationpro](https://estimationpro.ai/tools/blog/contractor-estimating-spreadsheet-vs-software))

**Implication for positioning:** don't win on "our AI is accurate." Win on the
feedback loop + transparency: *your* numbers, learned from *your* jobs.

---

## What competitors actually do (and don't)

### Estimate accuracy / feedback loop
| Tool | Learns from your actuals? | Evidence |
|---|---|---|
| Buildertrend, JobTread, Houzz Pro, Contractor Foreman | ❌ variance *dashboard*, human recalibrates | [softwareadvice](https://www.softwareadvice.com/construction/buildertrend-profile/) |
| Knowify | ❌ but tracks accuracy *by estimator* | [knowify](https://knowify.com/job-costing-software/) |
| Beck DESTINI, InEight | ✅ real cost-history feedback — **enterprise, desktop, precon** | [beck-technology](https://www.beck-technology.com/blog/how-to-use-the-cost-history-and-comparison-dashboard-in-destini-estimator) |
| RSMeans / 1build | ❌ generic market data, documented to drift locally | [capterra/RSMeans](https://www.capterra.com/p/151681/RSMeans/reviews/) |

White space proven: **no SMB/mobile tool ships an auto-calibrating personal cost
database or a per-line "estimate confidence" score from your own variance.**

### Visual / AI takeoff
- **PlanSwift** — Windows-only, no mobile, revoked perpetual licenses in 2025 → forced ~$1,749/user/yr ([bidicontracting](https://www.bidicontracting.com/blog/planswift-alternatives-2026)).
- **STACK** — no native mobile takeoff, ~$2,599/yr/seat ([softwareconnect](https://softwareconnect.com/reviews/stack-takeoff-estimate/)).
- **Bluebeam** — EOL'd its iPad app (Dec 31 2025), pushed to Safari ([bluebeam](https://www.bluebeam.com/revu-ipad-eol/)).
- **Togal.AI / Kreo** — AI auto-takeoff, commercial, desktop/web, $199–299/user/mo; "first pass, verify everything" ([eano](https://www.eano.com/blogs/ai-construction-takeoff-software-what-it-gets-right-and-where-it-still-falls-short)).
- **Handoff / CountBricks / magicplan** — mobile photo→estimate, but priced off **generic/ZIP data**, accuracy is vendor-marketing only ([handoff](https://www.handoff.ai/instant-ai-estimates)).
- **Apple RoomPlan** — LiDAR (Pro devices only), rectangles, no ceiling, fails on clutter ([Apple](https://developer.apple.com/augmented-reality/roomplan/)).

**Verified gap:** no one combines **lasso-a-region + auto-scale + priced from the
contractor's OWN learned costs + mobile + inside a full GC app.**

> AI-takeoff reality check: estimators only trust it for "rough orders of
> magnitude." Position AI as assist-and-verify with visible confidence — never
> autonomous. Overclaiming is exactly what they resent.

---

## The moat (how the two halves reinforce)

```
Lasso area on plan/photo  →  quantity  →  priced from YOUR learned cost DB
        ↑                                                    │
        │                                                    ▼
   next estimate sharper  ←  actuals feed back  ←  job runs (buyout→commitments→actuals)
```

Defensible because it requires every piece MAGE already has and rivals don't:
estimate-with-markup, the line-item linkage, job-cost actuals, the margin engine,
offline-first, iOS-native, plan calibration. Takeoff tools can't add the actuals
loop; PM tools can't add the takeoff; nobody has the personal cost DB.

---

## What shipped

### Build A — the cost-learning loop (PRs #29 → #30 → #31, stacked)
| PR | Build | Engine | Screen |
|---|---|---|---|
| #29 | **A1 Estimate Accuracy** | `utils/estimateActuals.ts` | `app/estimate-accuracy.tsx` |
| #30 | **A2 Cost Database** | `utils/costDatabase.ts` | `app/cost-database.tsx` |
| #31 | **A3 Estimate Confidence** | `utils/estimateConfidence.ts` | `app/estimate-confidence.tsx` |

- **A1** — per estimate line: bid → committed → actual, traced via
  `commitment.linkedEstimateItems`; per-line + per-trade variance; untraced
  commitments disclosed with a coverage %.
- **A2** — aggregates closed jobs into a personal price book: quantity-weighted
  unit rate, variability band, bid-bias, and a blended suggested rate
  (`w = n/(n+3)`) that solves cold-start; exposure-weighted overall bid accuracy.
- **A3** — price-checks a new estimate line-by-line: aligned / underpriced /
  padded / no-history, with a 0–100 score = share of $ backed by proven costs.

Verified by a synthetic harness (28/28 assertions) before shipping — which caught
and fixed a real bug (trades were keyed by CSI division number, not the human
category name).

### Build B — visual takeoff (PR #32)
- **B1** — `utils/takeoffGeometry.ts` (shoelace area + plan-viewer's calibration
  model), `utils/takeoffEstimate.ts` (price from the cost DB), `app/area-takeoff.tsx`
  (pick a plan/photo → 2-tap scale → trace area → instant price from your rates).
  Built on the app's existing stack (normalized coords, `react-native-svg`,
  GestureResponder, `expo-image-picker`) — no new native deps. Distinct from the
  existing AI PDF takeoff at `app/takeoff.tsx`.

All PRs: `tsc --noEmit` clean, `bun run lint` 0 errors / no new warnings.

---

## Roadmap

### Build B — Phase 2
- Linear (LF) + count (EA) takeoff alongside area.
- Freehand lasso (drag) in addition to tap-to-trace.
- Reuse saved `PlanSheet`s + their stored `PlanCalibration` (skip re-calibration).
- AI auto-detect rooms/areas as a **verifiable first pass** (confidence-flagged, one-tap override) — never autonomous.
- "Add to estimate" — write the priced takeoff straight into the project estimate, closing the loop end-to-end.

### Beyond (from the competitive sweep)
- **Lane A (moat):** Project Memory — vector-store every RFI/daily-report/CO rationale; ask your own institutional knowledge.
- **Lane B (demand):** public profile + lead funnel (Houzz Pro's pitch) feeding the existing Pipeline.
- **Lane C (network):** Sub Scorecard; anonymized peer benchmarks ("GCs your size are at 14% net; you're at 9%").

---

## Honest boundaries

- A2/A3 light up once there are **closed jobs with linked commitments**; the blend
  handles thin history, but the payoff compounds over time.
- "Actual" cost = `commitment.paidToDate` (sub/PO payments), not client invoices
  (revenue). Self-performed labor isn't captured until it flows through a
  commitment — disclosed in-app.
- Build B's pure engines are verified; the interactive canvas needs on-device
  testing (no simulator in the build environment).

---

_Sources are the 5-angle deep-research sweep (estimate-accuracy loops, digital
takeoff, AI auto-takeoff, mobile/LiDAR capture, contractor complaints), 2025–2026.
Vendor accuracy %s are marketing; competitor weaknesses and the absent-loop
pattern are from independent reviews (G2/Capterra/SoftwareConnect) and multiple
corroborating sources._
