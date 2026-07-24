# Profit Leak Faculty — CO Leak Detector + Sub-Bid Reality Check — Design

**Date:** 2026-07-23
**Status:** Approved (design); ready for implementation plan
**Branch target:** `claude/profit-leak` (off `main`)

## Goal

The brain that stops money leaking. Two capabilities, one theme:

1. **CO Leak Detector** — scan a daily report's text against the project's estimate scope; flag likely out-of-scope work; price the flagged items from the learned cost DB; one tap drafts the change order. GCs lose $1–5k/project to unbilled extras — this catches it the week it happens.
2. **Sub-Bid Reality Check** — when a commitment (sub price) is saved, compare it against the estimate items it covers (or the learned cost book by trade) and warn: too low = probably missing scope (the too-good bid that becomes week-2 COs); notably high = flag for review.

## Design principles (carried from JUDGES)

- **AI identifies, the engine prices.** The AI's only job is reading free text ("is this work in the scope?"). Every dollar figure comes from deterministic code (`lookupRate`, estimate sums).
- **The sub-bid check uses NO AI at all** — it's pure math, validator-tested, zero marginal cost.
- **Cost control:** leak scans are on-demand (explicit button), 1 fast-tier call per scan, result cached on the report (keyed by report id + text hash) so re-opening never re-spends.

## Grounding (verified in code, 2026-07-23)

- `DailyFieldReport` (`types/index.ts:1374`): `workPerformed`, `issuesAndDelays`, `materialsDelivered[]`, `workProgress[]`, photos. Screen `app/daily-report.tsx`; the existing AI seam is `generateHomeownerSummary` (`utils/aiService`) — same relay/metering pattern to follow.
- Scope basis: `project.linkedEstimate.items[]` (category/name/description/csiDivision) + `project.scope` free text + **prior approved COs** (already-captured additions are not leaks).
- `app/change-order.tsx` accepts prefill route params (`prefillReason`, `prefillDescription`, `prefillAmount`) — the "Draft CO" CTA routes there; no programmatic CO insertion needed in v1.
- `Commitment` (`types/index.ts:1809`): `amount`, `csiDivision?`, `description`, `linkedEstimateItems?: string[]`; created/edited in `app/job-costing.tsx`. `SubBidRecord` (`:1430`) and `BidPackageBid` exist but the commitment save is the lowest-friction hook.
- AI feature registration: add `'profitLeak'` to the `AIFeature` union + `FEATURE_CONFIG` (`utils/aiRateLimiterCore.ts`) with `tier: 'fast'`; rate limiting then applies automatically in `mageAI` — no server-side registration required.
- Brain Watch is on a staged branch (not main) — v1 surfaces live on the report + job-costing screens; Brain Watch integration is a follow-up when that branch lands.
- No prior art: `BidConfidenceBadge` scores estimate pricing variance only; out-of-scope detection is green-field.

## Architecture

### 1. Pure engine — `utils/profitLeak/`

**`scopeSummary.ts`** — `buildScopeSummary(project, changeOrders): string`. Deterministic scope text for the AI prompt: estimate items grouped by csiDivision (`category — name (qty unit)`), the `project.scope` free text, then "Already approved additions:" from approved COs. Capped length; pure.

**`leakPrompt.ts`** — `buildLeakPrompt(scopeSummary, report): string` + the zod-style schema shape for the response:
```ts
export interface LeakScanResult {
  items: LeakItem[];           // empty = no leak found
}
export interface LeakItem {
  description: string;         // what work looks out-of-scope
  trade: string;               // best-guess trade/category label
  unit: string;                // best-guess unit ('ls' allowed)
  quantity: number;            // best-guess qty (1 for lump sum)
  confidence: 'low' | 'medium' | 'high';
  reportQuote: string;         // the exact report phrase that triggered it
}
```
Prompt rules: compare ONLY against the provided scope; quote the report phrase; prefer empty over speculation; approved-CO work is in scope.

**`priceLeakItems.ts`** — `priceLeakItems(items, costDb): PricedLeakItem[]`. Each item priced deterministically: `lookupRate(costDb, trade, unit)` → `suggestedRate × quantity` with the entry's confidence; no history → `estimatedPrice: null` ("price it yourself"). Never invents a number.

**`subBidCheck.ts`** — `checkSubBid(commitment, project, costDb): SubBidVerdict`. Pure:
- Basis A (preferred): `linkedEstimateItems` present → sum those estimate lines' `lineTotal` → `variancePct = amount/expected − 1`.
- Basis B: `csiDivision`/description → map to trade → learned-cost expectation from matching estimate items priced at `lookupRate` rates.
- No basis → `{ verdict: 'unknown' }` (silent, no noise).
- Bands: `amount < 0.85×expected` → `'low'` ("verify scope is included" + the gap $); `> 1.30×expected` → `'high'`; else `'fair'`. Returns basis + expected + gap for the UI sentence.

### 2. Scan flow (client, OTA-safe)

On `app/daily-report.tsx` (view/edit of a saved report): a **"Scan for unbilled work"** action → `mageAI({ prompt, feature: 'profitLeak', tier: 'fast', schema, cacheKey: leak_<reportId>_<hash(workPerformed+issues)> })` → `priceLeakItems` → result card:
- Leaks found: each item with the report quote, trade, priced-from-history $ (or "no price history"), and **"Draft change order"** → `router.push('/change-order?projectId=…&prefillReason=Out-of-scope work (daily report <date>)&prefillDescription=<items>&prefillAmount=<sum>')`.
- Clean: "Nothing out of scope detected in this report." Result + `scannedAt` stored on the report record (additive optional field `leakScan?: { items: PricedLeakItem[]; scannedAt: string; textHash: string }` on `DailyFieldReport`) so the state persists and the badge ("scanned ✓ / N flags") shows in the report list.

### 3. Sub-bid check (client, OTA-safe, no AI)

In `app/job-costing.tsx` on commitment save (create or amount edit): run `checkSubBid`; on `'low'`/`'high'` show a non-blocking warning banner/alert with the comparison sentence ("Apex Electric: $8,000 — the estimate lines it covers total $9,400. Confirm panel + permits are included.") and log nothing when `'fair'`/`'unknown'`. Never blocks saving.

## Tier & metering

`profitLeak` fast-tier daily quotas via `FEATURE_CONFIG` (free tier gets the standard fast quota — the wow moment is free; caps prevent abuse). Sub-bid check is free math, ungated.

## Testing

- `scripts/validate-profit-leak.ts` in ship-check: scope-summary construction (grouping, CO inclusion, cap), leak-prompt grounding rules present, `priceLeakItems` (history vs null pricing, qty math), `checkSubBid` (basis A/B selection, band edges at 0.85/1.30, unknown fallback, zero/absent amounts never throw).
- tsc strict + anti-slop lint + full ship-check green.

## Out of scope (v2+)

- Photo/vision leak detection (text-only v1); batch scanning; auto-scan on save.
- Commitment→estimate-items picker UI improvement (noted gap; separate UX task).
- Scope versioning/audit trail; Brain Watch 'leak' AttentionItems (when that branch lands); programmatic CO creation (v1 uses the prefill route).

## Files

- **Create:** `utils/profitLeak/scopeSummary.ts`, `utils/profitLeak/leakPrompt.ts`, `utils/profitLeak/priceLeakItems.ts`, `utils/profitLeak/subBidCheck.ts`, `scripts/validate-profit-leak.ts`
- **Modify:** `utils/aiRateLimiterCore.ts` (AIFeature + FEATURE_CONFIG `profitLeak`), `types/index.ts` (`DailyFieldReport.leakScan?` additive), `app/daily-report.tsx` (scan action + result card + badge), `app/job-costing.tsx` (save-time check + banner), `package.json` (validator)
- **Reference (unchanged):** `utils/costDatabase.ts` (`lookupRate`), `utils/mageAI.ts`, `app/change-order.tsx` (prefill params)
