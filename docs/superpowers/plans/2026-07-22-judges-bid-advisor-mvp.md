# JUDGES — Bid Advisor MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the JUDGES bid-advisor faculty MVP — a "should I bid this job, and at what price?" advisor whose numbers are computed by pure, testable functions over the contractor's learned costs, with AI used only to phrase the result.

**Architecture:** A pure engine (`utils/judges/*`) computes a `BidVerdict` (verdict + fit score + recommended price range) from priced line items, cost-book confidence, margin risk, crew capacity, and job-type track record. A client orchestrator gathers inputs (from a typed scope → AI estimate, or an existing estimate/Lead) and calls `mageAI` only to narrate the already-computed verdict. A Business-gated `/judges` screen renders the verdict card.

**Tech Stack:** TypeScript (strict), React Native / Expo Router, bun. No jest — pure-function validators (`scripts/validate-*.ts`) chained into `ship-check`. Anti-slop lint: `Colors`/`Type`/`Tokens` only (no raw hex, inline `fontSize`, or `borderRadius`).

**Branch:** `claude/judges-bid-advisor` (already checked out, off `main`).

**Ship boundary:** engine + UI are OTA-safe (pure JS, reuses the existing `ai` relay for narration, client-gated). A dedicated `bid-judge` edge function with server-side `requireTier` + monthly cap is an owner-gated follow-up — NOT in this plan.

---

## File Structure

**Create (pure engine):**
- `utils/judges/types.ts` — domain types (`Verdict`, `ConfidenceLevel`, `PricedLine`, `BidDriver`, `BidVerdict`, `BidVerdictInput`, `JudgesLine`).
- `utils/judges/priceLines.ts` — `priceLines(lines, costDb)` → `PricedLine[]`.
- `utils/judges/capacityLoad.ts` — `computeCapacityLoad(projects, startISO, endISO)` → capacity summary.
- `utils/judges/typeMargin.ts` — `realizedMarginPct(project, commitments)` + `aggregateTypeMargin(closed, type, commitments)`.
- `utils/judges/computeBidVerdict.ts` — the orchestrating pure function.
- `utils/judges/narrateVerdict.ts` — `buildNarrationPrompt(verdict)` (pure) + `narrateVerdict(verdict)` (async, calls `mageAI`).
- `utils/judges/runJudges.ts` — client orchestrator that gathers inputs and calls the engine + narration.

**Create (validators):**
- `scripts/validate-judges-verdict.ts` — priceLines + computeBidVerdict + buildNarrationPrompt cases.
- `scripts/validate-judges-capacity.ts` — capacityLoad cases.
- `scripts/validate-judges-type-margin.ts` — realizedMarginPct + aggregateTypeMargin cases.

**Create (UI):**
- `components/judges/BidDriverRow.tsx` — one driver line.
- `components/judges/VerdictCard.tsx` — the result card.
- `app/judges.tsx` — the screen (describe path + pick path).

**Modify:**
- `hooks/useTierAccess.ts` — add `bid_scoring` FeatureKey → `'business'`.
- `package.json` — three `test:judges-*` scripts chained into `ship-check`.
- `app/_layout.tsx` — register the `judges` route.
- `app/(tabs)/construction-ai/index.tsx` — add a JUDGES tool entry.

**Reference (reuse, unchanged):** `utils/costDatabase.ts` (`buildCostDatabase`, `lookupRate`, `CostDatabase`, `CostBookEntry`), `utils/estimateCalibration.ts` (`computeCalibration`, `CalibrationReport`), `utils/marginRiskScore.ts` (`computeMarginRisk`, `MarginRiskScore`), `utils/estimateActuals.ts` (`computeEstimateActuals`, `EstimateActualsReport`), `utils/scopeQuestions.ts` (`buildEstimatePrompt`, `estimateSchema`, `scopeCacheKey`, `WizardAnswers`), `utils/mageAI.ts` (`mageAISmart`, `mageAI`).

---

## Conventions the implementer must follow

- **Validator harness** (mirror `scripts/validate-schedule-colors.ts`): top `let pass = 0, fail = 0;` + `function expect<T>(name: string, got: T, want: T)` doing `JSON.stringify(got) === JSON.stringify(want)`, `console.log('  ✓'/'  ✗', ...)`, footer `console.log(\`\n${pass} passed, ${fail} failed\`); if (fail > 0) process.exit(1);`. Imports are RELATIVE (`../utils/judges/...`, `../types`).
- **Pure functions never throw** on bad input — clamp/default instead.
- **Anti-slop:** UI uses `Type.*` text styles, `Tokens.spacing.*`/`Tokens.radius.*`, and theme colors — NO raw hex, NO inline `fontSize`, NO `borderRadius: <number>` (use `Tokens.radius.*`). Match the theming pattern of an existing screen (read `app/cost-xray.tsx` for the `useThemeColors()` + `makeStyles(theme)` idiom before writing UI).
- **Commit** after each task with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. `git add` only the files the task touched.
- **Gate check** after each task: `npx tsc --noEmit` clean; for validator tasks, the new `bun run test:judges-*` passes.

---

### Task 1: Domain types

**Files:**
- Create: `utils/judges/types.ts`

- [ ] **Step 1: Write the types**

```ts
// utils/judges/types.ts — JUDGES bid-advisor domain types.
// The engine is pure and deterministic; the AI only phrases these numbers.
import type { CostDatabase } from '@/utils/costDatabase';
import type { CalibrationReport } from '@/utils/estimateCalibration';
import type { MarginRiskScore } from '@/utils/marginRiskScore';

export type Verdict = 'take' | 'hold_firm' | 'walk';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/** A single scope line the engine prices (from an AI-drafted or existing estimate). */
export interface JudgesLine {
  category: string;
  unit: string;
  quantity: number;
  /** The estimate's own unit price (the "bid" assumption). */
  bidUnit: number;
}

export interface PricedLine {
  category: string;
  unit: string;
  quantity: number;
  bidUnit: number;
  /** lookupRate suggestedRate, or null when there's no history for this trade+unit. */
  learnedUnit: number | null;
  /** What we costed at: learnedUnit ?? bidUnit. */
  usedUnit: number;
  lineTrueCost: number;
  confidence: ConfidenceLevel;
  fromHistory: boolean;
}

export type DriverKind =
  | 'margin' | 'cost_confidence' | 'track_record' | 'capacity' | 'risk' | 'calibration';

export interface BidDriver {
  kind: DriverKind;
  polarity: 'positive' | 'negative';
  weight: number;   // 0..1 normalized contribution to the fit score
  detail: string;   // plain, number-bearing sentence
}

export interface CapacitySummary {
  loadPct: number;          // 0..1 committed load in the window
  bookedSolid: boolean;     // loadPct >= 0.85
  overlappingProjects: number;
}

export interface TypeMarginSummary {
  avgMarginPct: number | null; // null when no closed jobs of this type
  jobCount: number;
}

export interface BidVerdictInput {
  lines: JudgesLine[];
  costDb: CostDatabase;
  /** Target MARGIN fraction (0..1), e.g. 0.20 for 20%. */
  targetMargin: number;
  calibration?: CalibrationReport;
  marginRisk?: MarginRiskScore;
  capacity?: CapacitySummary;
  typeMargin?: TypeMarginSummary;
}

export interface BidVerdict {
  verdict: Verdict;
  fitScore: number;          // 0..100
  trueCost: number;
  recommendedLow: number;
  recommendedHigh: number;
  recommendedMid: number;
  marginAtMid: number;       // 0..1 fraction
  targetMargin: number;
  bidBiasNudge: number;      // fraction the range was raised (>0 = you habitually bid low)
  costConfidence: ConfidenceLevel;
  coveragePct: number;       // share of $ costed from real history
  lines: PricedLine[];
  drivers: BidDriver[];      // ranked by weight, both polarities
  disclaimers: string[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `utils/judges/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add utils/judges/types.ts
git commit -m "feat(judges): domain types for bid verdict engine"
```

---

### Task 2: priceLines + validator scaffold

**Files:**
- Create: `utils/judges/priceLines.ts`
- Create: `scripts/validate-judges-verdict.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** (`scripts/validate-judges-verdict.ts`)

```ts
// validate-judges-verdict.ts — unit tests for the JUDGES pricing + verdict engine.
// Run via: bun run scripts/validate-judges-verdict.ts
import { priceLines } from '../utils/judges/priceLines';
import type { CostDatabase, CostBookEntry } from '../utils/costDatabase';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// Minimal cost-book entry factory.
function entry(trade: string, unit: string, suggestedRate: number, confidence: CostBookEntry['confidence']): CostBookEntry {
  return {
    key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit,
    sampleCount: 5, jobCount: 5, personalRate: suggestedRate, variability: 0.1,
    bidBias: 0, baseline: suggestedRate, suggestedRate, confidence,
    totalActual: 1000, lastSeen: '2026-01-01', samples: [],
  };
}
function db(entries: CostBookEntry[]): CostDatabase {
  return { entries, jobsAnalyzed: 5, tradesTracked: entries.length, overallBidAccuracy: 0.9, asOf: '2026-01-01' };
}

console.log('\nJUDGES priceLines:');

const d = db([entry('Framing', 'sf', 12, 'high')]);
const priced = priceLines([{ category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 10 }], d);
expect('uses learned rate when history exists', priced[0].usedUnit, 12);
expect('marks fromHistory true', priced[0].fromHistory, true);
expect('lineTrueCost = qty * learnedUnit', priced[0].lineTrueCost, 1200);
expect('carries cost-book confidence', priced[0].confidence, 'high');

const priced2 = priceLines([{ category: 'Tile', unit: 'sf', quantity: 50, bidUnit: 8 }], d);
expect('falls back to bidUnit when no history', priced2[0].usedUnit, 8);
expect('fallback is low confidence', priced2[0].confidence, 'low');
expect('fallback fromHistory false', priced2[0].fromHistory, false);
expect('fallback lineTrueCost = qty * bidUnit', priced2[0].lineTrueCost, 400);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Add the script + run to verify it fails**

Add to `package.json` `scripts`: `"test:judges-verdict": "bun run scripts/validate-judges-verdict.ts"`, and append ` && bun run test:judges-verdict` to the `ship-check` chain (at the end, before any closing quote).

Run: `bun run test:judges-verdict`
Expected: FAIL — cannot find module `../utils/judges/priceLines`.

- [ ] **Step 3: Implement `priceLines`**

```ts
// utils/judges/priceLines.ts — price each scope line against the contractor's
// learned costs; fall back to the estimate's own price when there's no history.
import { lookupRate, type CostDatabase } from '@/utils/costDatabase';
import type { JudgesLine, PricedLine } from './types';

export function priceLines(lines: JudgesLine[], costDb: CostDatabase): PricedLine[] {
  return lines.map((l) => {
    const qty = Number.isFinite(l.quantity) && l.quantity > 0 ? l.quantity : 0;
    const bidUnit = Number.isFinite(l.bidUnit) && l.bidUnit > 0 ? l.bidUnit : 0;
    const hit = lookupRate(costDb, l.category, l.unit);
    const fromHistory = !!hit && hit.suggestedRate > 0;
    const learnedUnit = fromHistory ? hit!.suggestedRate : null;
    const usedUnit = fromHistory ? (learnedUnit as number) : bidUnit;
    return {
      category: l.category,
      unit: l.unit,
      quantity: qty,
      bidUnit,
      learnedUnit,
      usedUnit,
      lineTrueCost: qty * usedUnit,
      confidence: fromHistory ? hit!.confidence : 'low',
      fromHistory,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:judges-verdict`
Expected: `8 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils/judges/priceLines.ts scripts/validate-judges-verdict.ts package.json
git commit -m "feat(judges): priceLines against learned costs + validator"
```

---

### Task 3: capacityLoad

**Files:**
- Create: `utils/judges/capacityLoad.ts`
- Create: `scripts/validate-judges-capacity.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** (`scripts/validate-judges-capacity.ts`)

```ts
// validate-judges-capacity.ts — unit tests for cross-project crew capacity.
// Run via: bun run scripts/validate-judges-capacity.ts
import { computeCapacityLoad } from '../utils/judges/capacityLoad';
import type { Project } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// Build a minimal active project whose schedule occupies days in January 2026.
function proj(id: string, status: Project['status'], startDate: string, tasks: { startDay: number; durationDays: number }[]): Project {
  return {
    id, name: id, status,
    schedule: { id: `${id}-s`, projectId: id, startDate, tasks: tasks.map((t, i) => ({ id: `${id}-t${i}`, title: 't', phase: 'p', durationDays: t.durationDays, startDay: t.startDay, status: 'not_started' })) },
  } as unknown as Project;
}

console.log('\nJUDGES capacityLoad:');

// One active project fully occupies the window → high load.
const p1 = proj('A', 'in_progress', '2026-01-01', [{ startDay: 1, durationDays: 31 }]);
const busy = computeCapacityLoad([p1], '2026-01-01', '2026-01-31');
expect('overlapping project counted', busy.overlappingProjects, 1);
expect('bookedSolid when load high', busy.bookedSolid, true);

// Closed projects are excluded.
const closed = proj('B', 'closed', '2026-01-01', [{ startDay: 1, durationDays: 31 }]);
const free = computeCapacityLoad([closed], '2026-01-01', '2026-01-31');
expect('closed project excluded', free.overlappingProjects, 0);
expect('no load when nothing active', free.loadPct, 0);
expect('not booked when free', free.bookedSolid, false);

// A project with no schedule contributes 0.
const noSched = { id: 'C', name: 'C', status: 'in_progress' } as unknown as Project;
const none = computeCapacityLoad([noSched], '2026-01-01', '2026-01-31');
expect('no-schedule project → 0 load', none.loadPct, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Add script + run to verify it fails**

Add `"test:judges-capacity": "bun run scripts/validate-judges-capacity.ts"` to `package.json` and chain ` && bun run test:judges-capacity` into `ship-check`.

Run: `bun run test:judges-capacity`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeCapacityLoad`**

```ts
// utils/judges/capacityLoad.ts — cross-project crew load in a date window.
// "Am I already booked solid when this job would run?" No cross-project leveling
// exists today; this sums scheduled task-days that intersect the window against
// the window's calendar-day capacity. Pure over Project[].
import type { Project, ScheduleTask } from '@/types';
import type { CapacitySummary } from './types';

const MS_PER_DAY = 86_400_000;

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO), b = Date.parse(bISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/** Task calendar span [startDayISO, endDayISO) from schedule.startDate + startDay/duration. */
function taskWindow(scheduleStartISO: string, task: ScheduleTask): { start: number; end: number } | null {
  const base = Date.parse(scheduleStartISO);
  if (!Number.isFinite(base)) return null;
  const startDay = Math.max(1, Math.floor(task.startDay ?? 1));
  const dur = Math.max(1, Math.floor(task.durationDays ?? 1));
  const start = base + (startDay - 1) * MS_PER_DAY;
  const end = start + dur * MS_PER_DAY;
  return { start, end };
}

export function computeCapacityLoad(projects: Project[], windowStartISO: string, windowEndISO: string): CapacitySummary {
  const winStart = Date.parse(windowStartISO);
  const winEnd = Date.parse(windowEndISO);
  const windowDays = Math.max(1, daysBetween(windowStartISO, windowEndISO));
  if (!Number.isFinite(winStart) || !Number.isFinite(winEnd) || winEnd <= winStart) {
    return { loadPct: 0, bookedSolid: false, overlappingProjects: 0 };
  }

  let busyDays = 0;
  let overlapping = 0;
  for (const p of projects) {
    if (p.status === 'completed' || p.status === 'closed' || p.status === 'draft') continue;
    const sched = p.schedule;
    if (!sched?.startDate || !Array.isArray(sched.tasks) || sched.tasks.length === 0) continue;
    let projectOverlaps = false;
    for (const t of sched.tasks) {
      const w = taskWindow(sched.startDate, t);
      if (!w) continue;
      const overlapStart = Math.max(w.start, winStart);
      const overlapEnd = Math.min(w.end, winEnd);
      if (overlapEnd > overlapStart) {
        busyDays += (overlapEnd - overlapStart) / MS_PER_DAY;
        projectOverlaps = true;
      }
    }
    if (projectOverlaps) overlapping += 1;
  }

  // Capacity = the window's days per concurrent project already running. With one
  // crew baseline, loadPct is busyDays / windowDays, capped at 1.
  const loadPct = Math.min(1, busyDays / windowDays);
  return { loadPct, bookedSolid: loadPct >= 0.85, overlappingProjects: overlapping };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:judges-capacity`
Expected: `6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils/judges/capacityLoad.ts scripts/validate-judges-capacity.ts package.json
git commit -m "feat(judges): cross-project crew capacity load + validator"
```

---

### Task 4: typeMargin (realized margin by job type)

**Files:**
- Create: `utils/judges/typeMargin.ts`
- Create: `scripts/validate-judges-type-margin.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** (`scripts/validate-judges-type-margin.ts`)

```ts
// validate-judges-type-margin.ts — realized margin by job type.
// Run via: bun run scripts/validate-judges-type-margin.ts
import { realizedMarginPct, aggregateTypeMargin } from '../utils/judges/typeMargin';
import type { Project, Commitment } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// A closed renovation: estimate grandTotal 100k. We stub computeEstimateActuals
// indirectly by giving the project a linkedEstimate + a signed commitment as the
// actual cost proxy. realizedMarginPct = (grandTotal - totalActual)/grandTotal.
function closedReno(id: string, grandTotal: number): Project {
  return {
    id, name: id, type: 'renovation', status: 'closed',
    linkedEstimate: { id: `${id}-e`, items: [
      { materialId: 'm1', name: 'Framing', category: 'Framing', unit: 'sf', quantity: 100, unitPrice: 100, bulkPrice: 100, markup: 0, usesBulk: false, lineTotal: 10000, supplier: '' },
    ], globalMarkup: 20, baseTotal: grandTotal, markupTotal: 0, grandTotal, createdAt: '2026-01-01' },
  } as unknown as Project;
}

console.log('\nJUDGES typeMargin:');

const p = closedReno('R1', 100000);
// With no commitments/actuals, totalActual = 0 → realized margin = 1 (100%).
// (This exercises the formula; real data supplies actuals.)
const rm = realizedMarginPct(p, []);
expect('realizedMarginPct in [-1,1]', rm !== null && rm <= 1 && rm >= -1, true);

const agg = aggregateTypeMargin([p], 'renovation', []);
expect('aggregates one renovation', agg.jobCount, 1);
expect('avg present when history', agg.avgMarginPct !== null, true);

const other = aggregateTypeMargin([p], 'roofing', []);
expect('filters by type → none', other.jobCount, 0);
expect('null avg when no history', other.avgMarginPct, null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Add script + run to verify it fails**

Add `"test:judges-type-margin": "bun run scripts/validate-judges-type-margin.ts"` and chain ` && bun run test:judges-type-margin` into `ship-check`.

Run: `bun run test:judges-type-margin`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `typeMargin`**

```ts
// utils/judges/typeMargin.ts — "what do my <type> jobs actually earn?"
// Realized margin per closed project = (revenue - actual cost)/revenue, where
// revenue is the linked estimate grandTotal and actual cost is the estimate-
// actuals total (real actuals, else signed commitments as the cost proxy). Pure.
import type { Project, Commitment, ProjectType } from '@/types';
import { computeEstimateActuals } from '@/utils/estimateActuals';
import type { TypeMarginSummary } from './types';

const isClosed = (p: Project) => p.status === 'completed' || p.status === 'closed';

export function realizedMarginPct(project: Project, commitments: Commitment[]): number | null {
  const revenue = project.linkedEstimate?.grandTotal ?? 0;
  if (revenue <= 0) return null;
  const report = computeEstimateActuals(project, commitments);
  if (!report.hasEstimate) return null;
  const cost = report.totalActual > 0 ? report.totalActual : report.totalCommitted;
  if (cost <= 0) return null;
  const margin = (revenue - cost) / revenue;
  // Clamp to a sane band so one bad record can't dominate an average.
  return Math.max(-1, Math.min(1, margin));
}

export function aggregateTypeMargin(closedProjects: Project[], type: ProjectType, commitments: Commitment[]): TypeMarginSummary {
  const margins: number[] = [];
  for (const p of closedProjects) {
    if (!isClosed(p) || p.type !== type) continue;
    const m = realizedMarginPct(p, commitments);
    if (m !== null) margins.push(m);
  }
  if (margins.length === 0) return { avgMarginPct: null, jobCount: 0 };
  const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
  return { avgMarginPct: avg, jobCount: margins.length };
}
```

> **Implementer note:** The test's `realizedMarginPct` case has no actuals, so `totalActual`/`totalCommitted` are 0 → the function returns `null`, and `agg` would then be `{avgMarginPct: null, jobCount: 0}`. Before running, adjust the test so the closed project carries a signed `Commitment` (amount e.g. 70000, matching `computeEstimateActuals`'s tracing) so realized margin resolves to a real number (~0.30). Read `utils/estimateActuals.ts` to see exactly how a commitment is traced to the estimate (via `linkedEstimateItems` / category) and construct the fixture accordingly. The formula and API stay as written; only the fixture needs a real cost.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:judges-type-margin`
Expected: all pass (`avgMarginPct` ≈ 0.30 for the renovation, `null` for roofing).

- [ ] **Step 5: Commit**

```bash
git add utils/judges/typeMargin.ts scripts/validate-judges-type-margin.ts package.json
git commit -m "feat(judges): realized margin by job type + validator"
```

---

### Task 5: computeBidVerdict (the orchestrating pure function)

**Files:**
- Create: `utils/judges/computeBidVerdict.ts`
- Modify: `scripts/validate-judges-verdict.ts` (append verdict cases)

- [ ] **Step 1: Append failing tests** to `scripts/validate-judges-verdict.ts` (before the footer):

```ts
import { computeBidVerdict } from '../utils/judges/computeBidVerdict';
import type { BidVerdictInput } from '../utils/judges/types';

console.log('\nJUDGES computeBidVerdict:');

const baseDb = db([entry('Framing', 'sf', 12, 'high'), entry('Tile', 'sf', 20, 'high')]);
const strongInput: BidVerdictInput = {
  lines: [
    { category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 }, // 1200
    { category: 'Tile', unit: 'sf', quantity: 100, bidUnit: 20 },    // 2000
  ],
  costDb: baseDb,
  targetMargin: 0.20,
  typeMargin: { avgMarginPct: 0.22, jobCount: 6 },
  capacity: { loadPct: 0.2, bookedSolid: false, overlappingProjects: 1 },
};
const v = computeBidVerdict(strongInput);
expect('trueCost sums priced lines', v.trueCost, 3200);
expect('recommendedMid = trueCost/(1-targetMargin)', Math.round(v.recommendedMid), 4000);
expect('marginAtMid ≈ target', Math.round(v.marginAtMid * 100), 20);
expect('strong job → take', v.verdict, 'take');
expect('coverage full when all from history', v.coveragePct, 1);
expect('fitScore 0..100', v.fitScore >= 0 && v.fitScore <= 100, true);
expect('drivers ranked by weight desc', v.drivers.every((d, i, a) => i === 0 || a[i - 1].weight >= d.weight), true);

// Cold-start: no history → fallback pricing, low coverage, disclaimer present.
const coldInput: BidVerdictInput = {
  lines: [{ category: 'Excavation', unit: 'cy', quantity: 50, bidUnit: 40 }],
  costDb: db([]), targetMargin: 0.20,
};
const cold = computeBidVerdict(coldInput);
expect('cold-start coverage 0', cold.coveragePct, 0);
expect('cold-start disclaimer present', cold.disclaimers.length > 0, true);

// Empty scope → walk, zero cost, disclaimer, no throw.
const empty = computeBidVerdict({ lines: [], costDb: db([]), targetMargin: 0.20 });
expect('empty → walk', empty.verdict, 'walk');
expect('empty → 0 true cost', empty.trueCost, 0);

// bidBias nudge: an entry where you bid low (bidBias>0) raises the range.
const lowBidder = entry('Framing', 'sf', 12, 'high'); lowBidder.bidBias = 0.10;
const nudged = computeBidVerdict({ lines: [{ category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 }], costDb: db([lowBidder]), targetMargin: 0.20 });
expect('bidBiasNudge > 0 when you bid low', nudged.bidBiasNudge > 0, true);
```

- [ ] **Step 2: Run to verify new cases fail**

Run: `bun run test:judges-verdict`
Expected: FAIL — cannot find module `../utils/judges/computeBidVerdict`.

- [ ] **Step 3: Implement `computeBidVerdict`**

```ts
// utils/judges/computeBidVerdict.ts — turns priced scope + signals into a
// deterministic bid verdict. Every number here is computed, never AI-generated.
import { priceLines } from './priceLines';
import type { BidVerdict, BidVerdictInput, BidDriver, ConfidenceLevel, PricedLine, Verdict } from './types';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const CONF_SCORE: Record<ConfidenceLevel, number> = { low: 0.33, medium: 0.66, high: 1 };

function exposureConfidence(lines: PricedLine[]): { level: ConfidenceLevel; score: number; coveragePct: number } {
  const total = lines.reduce((a, l) => a + l.lineTrueCost, 0);
  if (total <= 0) return { level: 'low', score: 0.33, coveragePct: 0 };
  const wScore = lines.reduce((a, l) => a + l.lineTrueCost * CONF_SCORE[l.confidence], 0) / total;
  const coveragePct = lines.reduce((a, l) => a + (l.fromHistory ? l.lineTrueCost : 0), 0) / total;
  const level: ConfidenceLevel = wScore >= 0.8 ? 'high' : wScore >= 0.5 ? 'medium' : 'low';
  return { level, score: wScore, coveragePct };
}

function exposureBidBias(lines: PricedLine[], input: BidVerdictInput): number {
  // Exposure-weighted bidBias across lines that have a cost-book entry.
  const total = lines.reduce((a, l) => a + (l.fromHistory ? l.lineTrueCost : 0), 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (const l of lines) {
    if (!l.fromHistory) continue;
    const hit = input.costDb.entries.find((e) => e.key === `${l.category.trim().toLowerCase()}|${(l.unit || 'unit').trim().toLowerCase()}`);
    if (hit) acc += l.lineTrueCost * hit.bidBias;
  }
  return acc / total;
}

export function computeBidVerdict(input: BidVerdictInput): BidVerdict {
  const targetMargin = clamp01(input.targetMargin > 0 ? input.targetMargin : 0.2);
  const lines = priceLines(input.lines, input.costDb);
  const trueCost = lines.reduce((a, l) => a + l.lineTrueCost, 0);
  const conf = exposureConfidence(lines);

  // Bid range from margin target; nudge up if you habitually bid low (bidBias>0).
  const rawBias = exposureBidBias(lines, input);
  const bidBiasNudge = rawBias > 0 ? Math.min(rawBias, 0.15) : 0;
  const priceAt = (m: number) => (trueCost > 0 ? (trueCost / (1 - clamp01(m))) * (1 + bidBiasNudge) : 0);
  const recommendedMid = priceAt(targetMargin);
  const recommendedLow = priceAt(Math.max(0, targetMargin - 0.03));
  const recommendedHigh = priceAt(Math.min(0.95, targetMargin + 0.03));
  const marginAtMid = recommendedMid > 0 ? 1 - trueCost / recommendedMid : 0;

  // Weighted sub-scores; absent inputs drop out and remaining weights renormalize.
  const parts: { key: BidDriver['kind']; weight: number; score: number; detail: (s: number) => string }[] = [];
  parts.push({ key: 'cost_confidence', weight: 0.25, score: conf.score, detail: () => `Cost confidence is ${conf.level} — ${Math.round(conf.coveragePct * 100)}% of this scope is priced from your own history.` });
  parts.push({ key: 'margin', weight: 0.30, score: clamp01(marginAtMid / 0.2), detail: () => `At the recommended price you keep ${Math.round(marginAtMid * 100)}% margin.` });
  if (input.typeMargin && input.typeMargin.avgMarginPct !== null) {
    parts.push({ key: 'track_record', weight: 0.15, score: clamp01(input.typeMargin.avgMarginPct / 0.2), detail: () => `Your ${input.typeMargin!.jobCount} past jobs of this type average ${Math.round((input.typeMargin!.avgMarginPct as number) * 100)}% margin.` });
  }
  if (input.capacity) {
    parts.push({ key: 'capacity', weight: 0.15, score: clamp01(1 - input.capacity.loadPct), detail: () => (input.capacity!.bookedSolid ? `You're booked ~${Math.round(input.capacity!.loadPct * 100)}% in this window — squeezing it in risks your other jobs.` : `You have room in this window (${Math.round(input.capacity!.loadPct * 100)}% booked).`) });
  }
  if (input.marginRisk && input.marginRisk.hasBasis) {
    parts.push({ key: 'risk', weight: 0.15, score: clamp01(1 - input.marginRisk.score / 100), detail: () => `Margin-risk model scores this ${input.marginRisk!.band} (${input.marginRisk!.score}/100).` });
  }

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0) || 1;
  const fitScore = Math.round(100 * parts.reduce((a, p) => a + (p.weight / totalWeight) * clamp01(p.score), 0));

  const drivers: BidDriver[] = parts
    .map((p) => ({ kind: p.key, polarity: (p.score >= 0.6 ? 'positive' : 'negative') as BidDriver['polarity'], weight: p.weight / totalWeight, detail: p.detail(p.score) }))
    .sort((a, b) => b.weight - a.weight);

  // Calibration driver (non-scoring, additive narrative) if a top category is off.
  const topCal = input.calibration?.categories?.find((c) => c.direction !== 'aligned');
  if (topCal) drivers.push({ kind: 'calibration', polarity: topCal.direction === 'under' ? 'negative' : 'positive', weight: 0, detail: topCal.detail });

  const disclaimers: string[] = [];
  if (trueCost <= 0) disclaimers.push('No scope to price yet — add line items or describe the job.');
  else if (conf.coveragePct < 0.5) disclaimers.push('Based on your bid assumptions, not yet your history — this sharpens as you close jobs.');

  const verdict: Verdict = trueCost <= 0 ? 'walk' : fitScore >= 70 ? 'take' : fitScore >= 45 ? 'hold_firm' : 'walk';

  return {
    verdict, fitScore, trueCost,
    recommendedLow, recommendedHigh, recommendedMid, marginAtMid, targetMargin, bidBiasNudge,
    costConfidence: conf.level, coveragePct: conf.coveragePct,
    lines, drivers, disclaimers,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:judges-verdict`
Expected: all pass. (Verify `recommendedMid` for the strong case with `bidBiasNudge = 0` is exactly 4000; if a test asserts an exact figure on a nudged case, assert the direction, not the exact value.)

- [ ] **Step 5: Commit**

```bash
git add utils/judges/computeBidVerdict.ts scripts/validate-judges-verdict.ts
git commit -m "feat(judges): computeBidVerdict engine + verdict validator cases"
```

---

### Task 6: narration + client orchestrator

**Files:**
- Create: `utils/judges/narrateVerdict.ts`
- Create: `utils/judges/runJudges.ts`
- Modify: `scripts/validate-judges-verdict.ts` (append `buildNarrationPrompt` cases)

- [ ] **Step 1: Append a failing test** for the pure prompt builder to `scripts/validate-judges-verdict.ts`:

```ts
import { buildNarrationPrompt } from '../utils/judges/narrateVerdict';

console.log('\nJUDGES narration prompt:');
const promptStr = buildNarrationPrompt(v); // reuse `v` from the strong case above
expect('prompt names the verdict', promptStr.includes('take'), true);
expect('prompt includes the recommended price', promptStr.includes(String(Math.round(v.recommendedMid))), true);
expect('prompt forbids inventing numbers', /do not invent|only.*numbers|use only the numbers/i.test(promptStr), true);
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:judges-verdict`
Expected: FAIL — cannot find module `../utils/judges/narrateVerdict`.

- [ ] **Step 3: Implement `narrateVerdict.ts`**

```ts
// utils/judges/narrateVerdict.ts — phrasing only. The prompt hands the model the
// ALREADY-COMPUTED verdict and forbids inventing figures; a failure degrades to
// the engine's own driver sentences.
import { mageAI } from '@/utils/mageAI';
import type { BidVerdict } from './types';

const VERDICT_WORDS: Record<BidVerdict['verdict'], string> = {
  take: 'Take it', hold_firm: 'Bid but hold firm', walk: 'Walk away',
};

export function buildNarrationPrompt(v: BidVerdict): string {
  const facts = [
    `Verdict: ${v.verdict} (${VERDICT_WORDS[v.verdict]}).`,
    `Fit score: ${v.fitScore}/100.`,
    `Your true cost: ${Math.round(v.trueCost)}.`,
    `Recommended bid: ${Math.round(v.recommendedLow)}–${Math.round(v.recommendedHigh)} (mid ${Math.round(v.recommendedMid)}).`,
    `Margin at mid: ${Math.round(v.marginAtMid * 100)}%.`,
    `Cost confidence: ${v.costConfidence}; ${Math.round(v.coveragePct * 100)}% of scope priced from history.`,
    ...v.drivers.map((d) => `- (${d.polarity}) ${d.detail}`),
    ...v.disclaimers.map((s) => `- Note: ${s}`),
  ].join('\n');
  return [
    'You are a veteran construction estimator advising a contractor whether to bid a job.',
    'Write 2–3 short sentences explaining the recommendation in plain, confident language a contractor would respect.',
    'Use ONLY the numbers below — do not invent any figure, price, or percentage that is not present here.',
    'Lead with the verdict, then the single most important reason, then the biggest risk.',
    '',
    facts,
  ].join('\n');
}

export async function narrateVerdict(v: BidVerdict): Promise<string> {
  const fallback = v.drivers.slice(0, 2).map((d) => d.detail).join(' ');
  try {
    const res = await mageAI({ prompt: buildNarrationPrompt(v), tier: 'smart', maxTokens: 400, feature: 'bid_scoring' });
    if (res.success && typeof res.data === 'string' && res.data.trim()) return res.data.trim();
    if (res.success && res.raw && res.raw.trim()) return res.raw.trim();
    return fallback;
  } catch {
    return fallback;
  }
}
```

> **Implementer note:** Confirm how `mageAI` returns a plain-text (non-schema) answer — read `utils/mageAI.ts` around the return. If plain text arrives in `res.raw` rather than `res.data`, prefer `res.raw`. The fallback guarantees a non-empty string regardless.

- [ ] **Step 4: Implement `runJudges.ts`** (client orchestrator — verified by `tsc`, not the validator, since it's async + context-bound)

```ts
// utils/judges/runJudges.ts — gathers inputs and runs the JUDGES engine.
// Mirrors utils/plans/askYourPlans.ts: pure engine + a thin async wrapper.
import type { Project, Commitment, ChangeOrder, Invoice, ProjectType } from '@/types';
import { buildCostDatabase } from '@/utils/costDatabase';
import { computeCalibration } from '@/utils/estimateCalibration';
import { computeMarginRisk } from '@/utils/marginRiskScore';
import { mageAISmart } from '@/utils/mageAI';
import { buildEstimatePrompt, estimateSchema, scopeCacheKey, type WizardAnswers } from '@/utils/scopeQuestions';
import { computeBidVerdict } from './computeBidVerdict';
import { computeCapacityLoad } from './capacityLoad';
import { aggregateTypeMargin } from './typeMargin';
import { narrateVerdict } from './narrateVerdict';
import type { BidVerdict, JudgesLine } from './types';

export interface JudgesContext {
  projects: Project[];
  commitments: Commitment[];
  changeOrders?: ChangeOrder[];
  invoices?: Invoice[];
}

export interface JudgesResult {
  verdict: BidVerdict;
  narration: string;
  scopeSummary?: string;
}

/** Turn a described scope into priced line inputs via the estimate-wizard AI. */
export async function draftLinesFromScope(answers: WizardAnswers): Promise<{ lines: JudgesLine[]; summary: string } | null> {
  const res = await mageAISmart(buildEstimatePrompt(answers), estimateSchema, scopeCacheKey(answers));
  if (!res.success || !res.data || !Array.isArray(res.data.lineItems)) return null;
  const lines: JudgesLine[] = res.data.lineItems.map((li: { category: string; unit: string; quantity: number; unitCost: number }) => ({
    category: li.category, unit: li.unit, quantity: li.quantity, bidUnit: li.unitCost,
  }));
  return { lines, summary: typeof res.data.summary === 'string' ? res.data.summary : '' };
}

export async function runJudges(params: {
  lines: JudgesLine[];
  projectType: ProjectType;
  timelineWindow?: { startISO: string; endISO: string };
  targetMargin: number;
  project?: Project;      // when judging an existing project's estimate (enables marginRisk)
  ctx: JudgesContext;
  scopeSummary?: string;
}): Promise<JudgesResult> {
  const { projects, commitments } = params.ctx;
  const costDb = buildCostDatabase(projects, commitments);
  let calibration; try { calibration = computeCalibration({ projects, commitments }); } catch { /* additive */ }
  let capacity; if (params.timelineWindow) { try { capacity = computeCapacityLoad(projects, params.timelineWindow.startISO, params.timelineWindow.endISO); } catch { /* additive */ } }
  let typeMargin; try { typeMargin = aggregateTypeMargin(projects, params.projectType, commitments); } catch { /* additive */ }
  let marginRisk;
  if (params.project) {
    try { marginRisk = computeMarginRisk({ project: params.project, changeOrders: params.ctx.changeOrders ?? [], commitments, invoices: params.ctx.invoices ?? [] }); } catch { /* additive */ }
  }
  const verdict = computeBidVerdict({ lines: params.lines, costDb, targetMargin: params.targetMargin, calibration, marginRisk, capacity, typeMargin });
  const narration = await narrateVerdict(verdict);
  return { verdict, narration, scopeSummary: params.scopeSummary };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run test:judges-verdict && npx tsc --noEmit`
Expected: validator all-pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add utils/judges/narrateVerdict.ts utils/judges/runJudges.ts scripts/validate-judges-verdict.ts
git commit -m "feat(judges): verdict narration (phrasing-only) + client orchestrator"
```

---

### Task 7: tier gate (`bid_scoring` → Business)

**Files:**
- Modify: `hooks/useTierAccess.ts`

- [ ] **Step 1: Add the FeatureKey + required tier**

In the `FeatureKey` union (business-only group), add `| 'bid_scoring'`. In the `REQUIRED_TIER` record, add `bid_scoring: 'business',` alongside the other business entries (e.g. near `cost_xray: 'business'`).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean. (`REQUIRED_TIER` is `Record<FeatureKey, ...>`, so a missing entry would fail to compile — confirms wiring.)

- [ ] **Step 3: Commit**

```bash
git add hooks/useTierAccess.ts
git commit -m "feat(judges): bid_scoring feature gate (Business)"
```

---

### Task 8: VerdictCard + BidDriverRow components

**Files:**
- Create: `components/judges/BidDriverRow.tsx`
- Create: `components/judges/VerdictCard.tsx`

> **Before writing:** read `app/cost-xray.tsx` for the `useThemeColors()` + `makeStyles(theme)` idiom and how it uses `Type.*`, `Tokens.spacing.*`, `Tokens.radius.*`, and semantic colors. Match it. No raw hex, no inline `fontSize`, no numeric `borderRadius`.

- [ ] **Step 1: `BidDriverRow.tsx`** — renders one `BidDriver`: a lucide icon by `kind` (`cost_confidence`→`Database`, `margin`→`TrendingUp`, `track_record`→`History`, `capacity`→`CalendarClock`, `risk`→`AlertTriangle`, `calibration`→`Scale`), the `detail` sentence in `Type.body`, and a small polarity dot (positive → theme `success`, negative → theme `warning`/`danger`). Props: `{ driver: BidDriver }`.

- [ ] **Step 2: `VerdictCard.tsx`** — props `{ result: JudgesResult }`. Renders:
  - A verdict pill: `take`→success bg + "Take it", `hold_firm`→warning bg + "Bid but hold firm", `walk`→danger bg + "Walk away". Include the `fitScore` as `NN/100`.
  - The recommended range: `$<low>–$<high>` prominent (`Type.title1`/`title2`), with `true cost $<trueCost>` and `<margin>% margin at $<mid>` beneath (`Type.body`/caption). Format money with `toLocaleString()` and no cents.
  - The `narration` paragraph (`Type.body`).
  - A `ConfidenceLevel` badge (`<level> confidence · <coveragePct>% from your history`).
  - The ranked `drivers` as `BidDriverRow`s (cap at 5).
  - Each `disclaimers` string in a muted caption row.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && bun run lint`
Expected: tsc clean; lint 0 errors (anti-slop passes).

- [ ] **Step 4: Commit**

```bash
git add components/judges/BidDriverRow.tsx components/judges/VerdictCard.tsx
git commit -m "feat(judges): verdict card + driver row UI"
```

---

### Task 9: `/judges` screen + route

**Files:**
- Create: `app/judges.tsx`
- Modify: `app/_layout.tsx`

> **Before writing:** read `app/estimate-wizard.tsx` for how `WizardAnswers` are collected and `mageAISmart` is invoked with `loading` states, and `app/plan-intelligence.tsx` for a Business-gated screen shell (paywall CTA via `canAccess`).

- [ ] **Step 1: Build the screen** (`app/judges.tsx`)
  - Gate: `const { canAccess } = useTierAccess();` — if `!canAccess('bid_scoring')`, render the standard paywall CTA (mirror `plan-intelligence.tsx`) and return.
  - Two entry modes in one screen:
    - **Describe:** a multiline `TextInput` for the scope + a few compact inputs mapping to `WizardAnswers` (projectType picker over `ProjectType`, sizeSqft, quality, timelineWeeks; sensible defaults for the rest). A "Judge this job" button → build `WizardAnswers` → `draftLinesFromScope(answers)` → on success `runJudges({ lines, projectType, timelineWindow, targetMargin: 0.2, ctx })`. (Voice mic is a follow-up; MVP is text.)
    - **Pick existing:** a list of the user's draft `LinkedEstimate`s (from projects with `linkedEstimate`) and `Lead`s. Selecting one maps its items to `JudgesLine[]` (`{category, unit, quantity, bidUnit: unitPrice}` for `LinkedEstimateItem`; for a `Lead` with no estimate, route it into the Describe flow prefilled from `lead.scope`/`projectTypeMapped`). Then `runJudges(...)` with `project` set when judging an existing project's estimate (enables `marginRisk`).
  - `targetMargin`: derive from the project's `linkedEstimate.globalMarkup` when available (markup → margin: `m/(1+m)` with `m = globalMarkup/100`), else `0.2`.
  - `timelineWindow`: from `timelineWeeks` → `startISO = today`, `endISO = today + weeks*7` (ISO date strings). Use a plain `new Date()` at call time (runtime, not a validator).
  - Loading + error states: show a spinner while drafting/running; on `draftLinesFromScope` returning `null`, show "Couldn't read that scope — add a bit more detail and try again."
  - On success, render `<VerdictCard result={result} />`.
  - Get context from the existing providers/hooks (`useProjects()` etc. — read how `app/cost-xray.tsx` obtains `projects`/`commitments`).

- [ ] **Step 2: Register the route** in `app/_layout.tsx` (near `estimate-wizard`):

```tsx
<Stack.Screen
  name="judges"
  options={{
    title: "Bid Advisor",
    presentation: "modal",
    headerStyle: { backgroundColor: Colors.background },
    headerTintColor: Colors.primary,
    headerTitleStyle: { fontWeight: '700', color: Colors.text },
  }}
/>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/judges.tsx app/_layout.tsx
git commit -m "feat(judges): bid-advisor screen (describe + pick) + route"
```

---

### Task 10: Construction-AI hub entry

**Files:**
- Modify: `app/(tabs)/construction-ai/index.tsx`

- [ ] **Step 1: Add a JUDGES tool card**

Read the existing tool-card/`CATEGORIES` pattern in `app/(tabs)/construction-ai/index.tsx` and add a "Bid Advisor" card (icon: lucide `Scale` or `Gavel`; subtitle "Should I bid this — and at what price?") that `router.push('/judges')`. Match the existing card markup exactly (tokens, not raw styles). If the hub gates cards by tier, mark this one Business.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/construction-ai/index.tsx"
git commit -m "feat(judges): surface Bid Advisor in the Construction-AI hub"
```

---

### Task 11: Full ship-check + branch review

- [ ] **Step 1: Run the full gate**

Run: `bun run ship-check`
Expected: EXIT 0 — typecheck + lint + all validators (including `test:judges-verdict`, `test:judges-capacity`, `test:judges-type-margin`) pass.

- [ ] **Step 2: Commit any fixes**, then the branch is ready for the adversarial-review workflow (money-math verification) before merge.

---

## Self-Review

**Spec coverage:** deterministic-engine principle → Tasks 2–6 (pure, AI only in narrateVerdict). Both input paths → Task 9 (describe + pick). Cost-learning pricing → Task 2. Margin risk → Task 6 orchestrator. Capacity → Task 3. Track record → Task 4. Verdict + range + fit score + drivers → Task 5. Narration → Task 6. Business gate → Task 7. Cold-start disclaimer → Task 5. UI card → Task 8. Screen/route → Task 9. Hub entry → Task 10. Validators in ship-check → Tasks 2/3/4/5/6 + Task 11. **No gaps.**

**Placeholder scan:** all code steps contain real code; the two `Implementer note`s point to concrete verification actions (mageAI return field; estimate-actuals commitment tracing for the fixture), not vague TODOs.

**Type consistency:** `JudgesLine`/`PricedLine`/`BidVerdict`/`BidVerdictInput`/`CapacitySummary`/`TypeMarginSummary` defined in Task 1 and used identically in Tasks 2–6 and 8–9. `bid_scoring` used in Tasks 6, 7, 9. `estimateSchema.lineItems` field names (`category`, `unit`, `quantity`, `unitCost`) match Task 6's mapping. `computeEstimateActuals` totals (`totalActual`, `totalCommitted`, `hasEstimate`) match Task 4. `computeCalibration` return (`categories[].direction`/`detail`) matches Task 5. All consistent.
