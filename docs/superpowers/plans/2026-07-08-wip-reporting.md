# WIP Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full Work-In-Progress (WIP) schedule — a pure computation engine, a period-snapshot/lock collection, a profit-fade watch that reuses MAGE's EVM, a portfolio + per-project screen, and PDF/CSV export — gated to Business+.

**Architecture:** The core is a **pure engine** (`utils/wip.ts`, zero React/RN imports) that turns explicit inputs into a fully computed WIP row plus portfolio roll-up and flag classification, exercised heavily by a pure-fn validator (`scripts/validate-wip.ts`) wired into `ship-check`. Live WIP is computed on the fly from existing project financials (change orders, commitments, invoices, AIA pay-apps, budget/EVM); only **period snapshots** persist. A thin `WipContext` owns the `tertiary_wip_periods` collection (AsyncStorage + `supabaseWrite`), enforcing lock-immutability. The screen (`app/wip-report.tsx`) composes the engine over active projects, seeds an editable cost-to-date suggestion, and drives lock + export.

**Tech Stack:** React Native / Expo (OTA-safe — no native deps), TypeScript strict, `@nkzw/create-context-hook`, `@tanstack/react-query`-free local context, Supabase (RLS table via offline queue), `expo-print` + `expo-sharing` for PDF, lucide-react-native icons, themed styles (`useThemedStyles` / `ThemeColors`).

**Why a thin `WipContext` (not a screen-local hook):** WIP snapshots are reusable beyond the report screen — a portfolio-health badge on the dashboard, a future surety/bonding export, and the client portal can all read locked periods. Centralizing the collection + the lock-immutability guard in one context avoids duplicating the persistence + guard logic per callsite, mirroring how `PropertyContext` / `BidsContext` own their `tertiary_*` collections.

---

## File Structure

**New files**
- `utils/wip.ts` — pure engine: `computeWipRow`, `computeWipPortfolio`, `flagWipRow`, `assertPeriodEditable`, and pure suggest/derive helpers (`suggestCostToDate`, `suggestBilledToDate`, `sumApprovedChangeOrders`, `deriveOriginalContract`, `clamp`). No React/RN.
- `scripts/validate-wip.ts` — pure-fn validator over `utils/wip.ts` (mirrors `scripts/validate-schedule-colors.ts`), wired into `ship-check`.
- `contexts/WipContext.tsx` — `[WipProvider, useWip]` created with `createContextHook`; owns `tertiary_wip_periods` (AsyncStorage + `supabaseWrite`); `addPeriod` / `lockPeriod` / `updatePeriod` with lock guard.
- `utils/wipExport.ts` — pure `wipPeriodToCSV(period)` + `buildWipHtml(period, companyName)` and `shareWipPeriodPdf(period, companyName)` (expo-print/sharing).
- `app/wip-report.tsx` — the screen (gate wrapper + inner).
- `supabase/migrations/20260708120000_wip_periods.sql` — additive `wip_periods` table + RLS.

**Modified files**
- `types/index.ts` — add `WipRowInput`, `WipRow`, `WipPortfolio`, `WipSnapshotRow`, `WipFlags`, `WipPeriod`.
- `package.json` — add `test:wip` script; add it to the `ship-check` chain.
- `hooks/useTierAccess.ts` — add `FeatureKey` `'wip_reporting'` + `REQUIRED_TIER['wip_reporting'] = 'business'`.
- `app/_layout.tsx` — mount `<WipProvider>` inside `<ProjectProvider>`; register `<Stack.Screen name="wip-report" … />`.
- `components/DesktopSidebar.tsx` — add the `FINANCIALS` nav entry.
- `supabase/schema.sql` — mirror the `wip_periods` table + policies.

---

## Task 1: Domain types

**Files:**
- Modify: `types/index.ts` (append before the `SendableItemKind` union near end of file, ~line 3762)

- [ ] **Step 1: Add the WIP types**

Insert this block immediately **before** the existing `export type SendableItemKind =` line in `types/index.ts`:

```typescript
// ─── WIP (Work-In-Progress) reporting ───────────────────────────────────────
// Pure inputs the WIP engine (utils/wip.ts) consumes. Every field is an
// explicit number so the engine stays side-effect-free and trivially testable.
export interface WipRowInput {
  originalContract: number;
  approvedChangeOrders: number;
  totalEstimatedCost: number;
  costToDate: number;            // auto-suggested, user-editable
  billedToDate: number;          // single billing source (pay-apps OR invoices)
  percentCompleteOverride?: number; // optional manual 0..1
}

// Fully computed WIP row (all derived, no NaN — engine guards divide-by-zero).
export interface WipRow {
  revisedContract: number;
  percentComplete: number;       // 0..1
  earnedRevenue: number;
  overbilling: number;           // >= 0, mutually exclusive with underbilling
  underbilling: number;          // >= 0
  estGrossProfit: number;
  estGrossMarginPct: number;     // 0..1 (0 when revisedContract === 0)
  profitToDate: number;
  costToComplete: number;        // >= 0
  backlog: number;
}

// Portfolio roll-up across many WIP rows.
export interface WipPortfolio {
  revisedContract: number;
  totalEstimatedCost: number;
  costToDate: number;
  earnedRevenue: number;
  billedToDate: number;
  overbilling: number;
  underbilling: number;
  backlog: number;
  weightedMarginPct: number;     // (revised − cost) / revised across the portfolio
}

// Profit-fade watch output (badges + human-readable reasons).
export interface WipFlags {
  profitFade: boolean;
  billingSwing: boolean;
  scheduleDivergence: boolean;
  reasons: string[];
}

// One frozen project line inside a snapshot period.
export interface WipSnapshotRow {
  projectId: string;
  projectName: string;
  input: WipRowInput;
  output: WipRow;
}

// A point-in-time WIP snapshot. Live WIP is computed on the fly; only these
// persist. `lockedAt` makes the period immutable (invoice-immutability
// precedent) — editing a locked period is blocked; create a new period.
export interface WipPeriod {
  id: string;
  periodEndDate: string;         // ISO date the WIP is "as of"
  createdAt: string;
  createdBy?: string;
  companyId?: string;
  rows: WipSnapshotRow[];
  portfolioTotals: WipPortfolio;
  notes?: string;
  lockedAt?: string;             // set → immutable
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors; the new interfaces are self-contained).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "$(cat <<'EOF'
types: add WIP reporting domain types

Adds WipRowInput/WipRow/WipPortfolio/WipSnapshotRow/WipFlags/WipPeriod as the
single source of truth for the WIP engine, snapshot collection, and screen.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure engine core — `computeWipRow` + `computeWipPortfolio` (validator FIRST)

**Files:**
- Create: `scripts/validate-wip.ts`
- Create: `utils/wip.ts`
- Modify: `package.json` (add `test:wip` script + `ship-check` chain)

- [ ] **Step 1: Write the failing validator (core cases first)**

Create `scripts/validate-wip.ts`:

```typescript
// validate-wip.ts — unit tests for the pure WIP engine (utils/wip.ts).
// Run via: bun run scripts/validate-wip.ts
//
// Bun executes TypeScript natively — we import the module and exercise the
// pure functions directly. No mocking: utils/wip.ts has zero React Native deps.

import {
  computeWipRow,
  computeWipPortfolio,
} from '../utils/wip';
import type { WipRowInput, WipRow, WipSnapshotRow } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n   got:', got, '\n   want:', want); }
}

console.log('\nWIP engine validation:');

// ── Base row: chosen so every output is a clean number ──────────────────────
const base: WipRowInput = {
  originalContract: 100000,
  approvedChangeOrders: 0,
  totalEstimatedCost: 75000,
  costToDate: 30000,
  billedToDate: 45000,
};
const baseRow = computeWipRow(base);

expect('revisedContract = original + approvedCO', baseRow.revisedContract, 100000);
expect('percentComplete = cost/est', baseRow.percentComplete, 0.4);
expect('earnedRevenue = revised * %', baseRow.earnedRevenue, 40000);
expect('overbilling = billed − earned', baseRow.overbilling, 5000);
expect('underbilling = 0 when overbilled', baseRow.underbilling, 0);
expect('estGrossProfit = revised − cost', baseRow.estGrossProfit, 25000);
expect('estGrossMarginPct = profit/revised', baseRow.estGrossMarginPct, 0.25);
expect('profitToDate = earned − cost', baseRow.profitToDate, 10000);
expect('costToComplete = est − cost', baseRow.costToComplete, 45000);
expect('backlog = revised − earned', baseRow.backlog, 60000);

// ── revised contract adds approved change orders ────────────────────────────
expect('revisedContract includes approvedCO',
  computeWipRow({ ...base, approvedChangeOrders: 20000 }).revisedContract, 120000);

// ── percentCompleteOverride wins over cost-based ratio ──────────────────────
const overridden = computeWipRow({ ...base, percentCompleteOverride: 0.6 });
expect('override sets percentComplete', overridden.percentComplete, 0.6);
expect('override → earnedRevenue', overridden.earnedRevenue, 60000);
expect('override → underbilling (billed < earned)', overridden.underbilling, 15000);
expect('override → overbilling 0', overridden.overbilling, 0);

// ── percentComplete caps at 1 (cost overruns estimate) ──────────────────────
expect('percentComplete caps at 1',
  computeWipRow({ ...base, costToDate: 150000 }).percentComplete, 1);
expect('override caps at 1',
  computeWipRow({ ...base, percentCompleteOverride: 1.5 }).percentComplete, 1);
expect('override floors at 0',
  computeWipRow({ ...base, percentCompleteOverride: -0.2 }).percentComplete, 0);

// ── totalEstimatedCost === 0 guard → percentComplete 0, no NaN ──────────────
const zeroEst = computeWipRow({ ...base, totalEstimatedCost: 0 });
expect('zero est cost → percentComplete 0', zeroEst.percentComplete, 0);
expect('zero est cost → earnedRevenue 0', zeroEst.earnedRevenue, 0);

// ── zero revised contract → estGrossMarginPct 0 (no NaN) ────────────────────
const zeroContract = computeWipRow({
  originalContract: 0, approvedChangeOrders: 0,
  totalEstimatedCost: 5000, costToDate: 1000, billedToDate: 0,
});
expect('zero contract → estGrossMarginPct 0', zeroContract.estGrossMarginPct, 0);
expect('zero contract → backlog 0', zeroContract.backlog, 0);

// ── under-billing branch (billed < earned) ──────────────────────────────────
const under = computeWipRow({ ...base, billedToDate: 25000 });
expect('underbilling = earned − billed', under.underbilling, 15000);
expect('overbilling 0 when underbilled', under.overbilling, 0);

// ── costToComplete never negative ───────────────────────────────────────────
expect('costToComplete floors at 0',
  computeWipRow({ ...base, costToDate: 999999 }).costToComplete, 0);

// ── portfolio roll-up sums ──────────────────────────────────────────────────
const rows: WipSnapshotRow[] = [
  { projectId: 'a', projectName: 'A', input: base, output: baseRow },
  { projectId: 'b', projectName: 'B',
    input: { ...base, approvedChangeOrders: 20000 },
    output: computeWipRow({ ...base, approvedChangeOrders: 20000 }) },
];
const port = computeWipPortfolio(rows);
expect('portfolio revisedContract sum', port.revisedContract, 220000);
expect('portfolio totalEstimatedCost sum', port.totalEstimatedCost, 150000);
expect('portfolio earnedRevenue sum', port.earnedRevenue, 88000);
expect('portfolio billedToDate sum', port.billedToDate, 90000);
expect('portfolio weightedMarginPct', port.weightedMarginPct, (220000 - 150000) / 220000);
expect('portfolio empty → weightedMarginPct 0', computeWipPortfolio([]).weightedMarginPct, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run the validator to verify it fails**

Run: `bun run scripts/validate-wip.ts`
Expected: FAIL — `Cannot find module '../utils/wip'` (module does not exist yet).

- [ ] **Step 3: Implement the engine core**

Create `utils/wip.ts`:

```typescript
// utils/wip.ts — pure WIP (Work-In-Progress) schedule engine.
// NO React / React Native imports. Every function is deterministic and
// side-effect-free so scripts/validate-wip.ts can exercise it directly.
import type {
  WipRowInput, WipRow, WipPortfolio, WipSnapshotRow,
} from '@/types';

/** Clamp with NaN → lo, so divide-by-zero never leaks a NaN downstream. */
export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Turn explicit inputs into a fully computed WIP row. */
export function computeWipRow(input: WipRowInput): WipRow {
  const {
    originalContract, approvedChangeOrders, totalEstimatedCost,
    costToDate, billedToDate, percentCompleteOverride,
  } = input;

  const revisedContract = originalContract + approvedChangeOrders;

  const percentComplete = percentCompleteOverride != null
    ? clamp(percentCompleteOverride, 0, 1)
    : (totalEstimatedCost === 0 ? 0 : clamp(costToDate / totalEstimatedCost, 0, 1));

  const earnedRevenue = revisedContract * percentComplete;
  const overbilling = Math.max(0, billedToDate - earnedRevenue);
  const underbilling = Math.max(0, earnedRevenue - billedToDate);
  const estGrossProfit = revisedContract - totalEstimatedCost;
  const estGrossMarginPct = revisedContract === 0 ? 0 : estGrossProfit / revisedContract;
  const profitToDate = earnedRevenue - costToDate;
  const costToComplete = Math.max(0, totalEstimatedCost - costToDate);
  const backlog = revisedContract - earnedRevenue;

  return {
    revisedContract, percentComplete, earnedRevenue, overbilling, underbilling,
    estGrossProfit, estGrossMarginPct, profitToDate, costToComplete, backlog,
  };
}

/** Sum a set of snapshot rows into a portfolio roll-up with weighted margin. */
export function computeWipPortfolio(rows: WipSnapshotRow[]): WipPortfolio {
  const acc: WipPortfolio = {
    revisedContract: 0, totalEstimatedCost: 0, costToDate: 0, earnedRevenue: 0,
    billedToDate: 0, overbilling: 0, underbilling: 0, backlog: 0, weightedMarginPct: 0,
  };
  for (const r of rows) {
    acc.revisedContract += r.output.revisedContract;
    acc.totalEstimatedCost += r.input.totalEstimatedCost;
    acc.costToDate += r.input.costToDate;
    acc.earnedRevenue += r.output.earnedRevenue;
    acc.billedToDate += r.input.billedToDate;
    acc.overbilling += r.output.overbilling;
    acc.underbilling += r.output.underbilling;
    acc.backlog += r.output.backlog;
  }
  acc.weightedMarginPct = acc.revisedContract === 0
    ? 0
    : (acc.revisedContract - acc.totalEstimatedCost) / acc.revisedContract;
  return acc;
}
```

- [ ] **Step 4: Run the validator to verify it passes**

Run: `bun run scripts/validate-wip.ts`
Expected: PASS — all cases print `✓`, final line `N passed, 0 failed`.

- [ ] **Step 5: Wire the validator into scripts + ship-check**

In `package.json`, add the `test:wip` script after `test:cpm`:

```json
    "test:cpm": "bun run scripts/test-cpm.ts",
    "test:wip": "bun run scripts/validate-wip.ts",
```

And extend the `ship-check` chain — insert `&& bun run test:wip` immediately after `&& bun run test:cpm`:

```json
    "ship-check": "bun run typecheck && bun run lint && bun run test:colors && bun run test:health && bun run test:barlabel && bun run test:gating && bun run test:sched-schema && bun run test:sched-history && bun run test:sched-depcycle && bun run test:sched-copilot && bun run test:cpm && bun run test:wip && bun run test:app-slop",
```

- [ ] **Step 6: Verify the script runs via bun**

Run: `bun run test:wip`
Expected: PASS — same output as Step 4.

- [ ] **Step 7: Commit**

```bash
git add utils/wip.ts scripts/validate-wip.ts package.json
git commit -m "$(cat <<'EOF'
wip: pure engine core (computeWipRow + portfolio) with validator

Adds the side-effect-free WIP row/portfolio math and a bun validator wired
into ship-check. Divide-by-zero guards return 0, never NaN.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Suggest / derive helpers (validator-extended, TDD)

`suggestCostToDate` sums recorded incurred cost from commitments (`paidToDate`). `suggestBilledToDate` picks a **single** billing source — pay-apps if the project has any, else invoices — never summing both. `deriveOriginalContract` and `sumApprovedChangeOrders` supply the remaining engine inputs from existing collections.

> Note on scope vs spec wording: the spec sketches `suggestCostToDate(project)`. To keep `utils/wip.ts` pure and React-free, these helpers take **explicit collections** (the screen passes `getCommitmentsForProject(id)` etc.), not the whole context. `deriveOriginalContract` is added because `Project` has no direct `contractValue` field — the original contract is recovered from the pay-app `originalContractSum`, else the first change order's `originalContractValue`, else `targetBudget.amount`, else `gmpCap`. Approved-change-order **cost** is intentionally excluded from `suggestCostToDate` because `ChangeOrder` carries a contract-value delta (`changeAmount`), not a cost figure — including it would be silently wrong.

**Files:**
- Modify: `scripts/validate-wip.ts`
- Modify: `utils/wip.ts`

- [ ] **Step 1: Extend the validator with helper cases (FIRST)**

In `scripts/validate-wip.ts`, extend the import to add the helpers:

```typescript
import {
  computeWipRow,
  computeWipPortfolio,
  suggestCostToDate,
  suggestBilledToDate,
  sumApprovedChangeOrders,
  deriveOriginalContract,
} from '../utils/wip';
import type {
  WipRowInput, WipRow, WipSnapshotRow,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project,
} from '../types';
```

Then add these cases immediately **before** the final `console.log(\`\n${pass}...` line:

```typescript
// ── suggestCostToDate: sum of commitment paidToDate ─────────────────────────
const commitments = [
  { paidToDate: 1000 }, { paidToDate: 500 }, {},
] as unknown as Commitment[];
expect('suggestCostToDate sums paidToDate', suggestCostToDate(commitments), 1500);
expect('suggestCostToDate empty → 0', suggestCostToDate([]), 0);

// ── suggestBilledToDate: pay-apps win when present ──────────────────────────
const payApps = [
  { totals: { currentPaymentDue: 2000 } },
  { totals: { currentPaymentDue: 500 } },
] as unknown as SavedAIAPayApp[];
const invoices = [
  { totalDue: 9999 }, { totalDue: 1 },
] as unknown as Invoice[];
expect('billed: pay-apps preferred (no double count)',
  suggestBilledToDate(invoices, payApps), 2500);
expect('billed: invoices when no pay-apps',
  suggestBilledToDate(invoices, []), 10000);
expect('billed: both empty → 0', suggestBilledToDate([], []), 0);

// ── sumApprovedChangeOrders: only approved status counts ────────────────────
const cos = [
  { status: 'approved', changeAmount: 5000 },
  { status: 'draft', changeAmount: 9999 },
  { status: 'approved', changeAmount: 1500 },
  { status: 'rejected', changeAmount: 7777 },
] as unknown as ChangeOrder[];
expect('sumApprovedChangeOrders only approved', sumApprovedChangeOrders(cos), 6500);

// ── deriveOriginalContract precedence: pay-app > CO > targetBudget > gmpCap ──
expect('originalContract from pay-app',
  deriveOriginalContract(
    { targetBudget: { amount: 111 }, gmpCap: 222 } as unknown as Project,
    [{ originalContractValue: 333 }] as unknown as ChangeOrder[],
    [{ originalContractSum: 88000 }] as unknown as SavedAIAPayApp[]),
  88000);
expect('originalContract falls back to CO',
  deriveOriginalContract(
    { targetBudget: { amount: 111 }, gmpCap: 222 } as unknown as Project,
    [{ originalContractValue: 333 }] as unknown as ChangeOrder[], []),
  333);
expect('originalContract falls back to targetBudget',
  deriveOriginalContract(
    { targetBudget: { amount: 111 }, gmpCap: 222 } as unknown as Project, [], []),
  111);
expect('originalContract falls back to gmpCap',
  deriveOriginalContract({ gmpCap: 222 } as unknown as Project, [], []), 222);
expect('originalContract → 0 when nothing available',
  deriveOriginalContract({} as unknown as Project, [], []), 0);
```

- [ ] **Step 2: Run to verify new cases fail**

Run: `bun run scripts/validate-wip.ts`
Expected: FAIL — import error: `suggestCostToDate` (and the other helpers) not exported from `utils/wip`.

- [ ] **Step 3: Implement the helpers**

Append to `utils/wip.ts` (add the extra type imports to the existing top-of-file import first):

```typescript
import type {
  WipRowInput, WipRow, WipPortfolio, WipSnapshotRow,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project,
} from '@/types';
```

Then append these functions to the end of `utils/wip.ts`:

```typescript
/** Σ approved change-order value deltas → the revised-contract adjustment. */
export function sumApprovedChangeOrders(changeOrders: ChangeOrder[]): number {
  return changeOrders
    .filter((co) => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount || 0), 0);
}

/**
 * Recover the original (pre-change-order) contract value. `Project` has no
 * direct contract field, so fall back through the best available sources.
 */
export function deriveOriginalContract(
  project: Pick<Project, 'targetBudget' | 'gmpCap'> | null | undefined,
  changeOrders: ChangeOrder[],
  payApps: SavedAIAPayApp[],
): number {
  const fromPayApp = payApps[0]?.originalContractSum;
  if (typeof fromPayApp === 'number' && fromPayApp > 0) return fromPayApp;
  const fromCo = changeOrders[0]?.originalContractValue;
  if (typeof fromCo === 'number' && fromCo > 0) return fromCo;
  const fromBudget = project?.targetBudget?.amount;
  if (typeof fromBudget === 'number' && fromBudget > 0) return fromBudget;
  return project?.gmpCap ?? 0;
}

/** Auto-suggested cost-to-date: Σ incurred commitment cost (paidToDate). */
export function suggestCostToDate(commitments: Commitment[]): number {
  return commitments.reduce((sum, c) => sum + (c.paidToDate ?? 0), 0);
}

/**
 * Auto-suggested billed-to-date from a SINGLE source to avoid double counting:
 * a project bills via pay-apps OR invoices (a pay-app is itself the invoice).
 * Prefer pay-apps when any exist, else fall back to invoices.
 */
export function suggestBilledToDate(
  invoices: Invoice[],
  payApps: SavedAIAPayApp[],
): number {
  if (payApps.length > 0) {
    return payApps.reduce((sum, p) => sum + (p.totals?.currentPaymentDue ?? 0), 0);
  }
  return invoices.reduce((sum, i) => sum + (i.totalDue ?? 0), 0);
}
```

- [ ] **Step 4: Run to verify all cases pass**

Run: `bun run scripts/validate-wip.ts`
Expected: PASS — `N passed, 0 failed`.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add utils/wip.ts scripts/validate-wip.ts
git commit -m "$(cat <<'EOF'
wip: cost-to-date / billed-to-date / contract-derivation helpers

suggestBilledToDate picks a single billing source (pay-apps else invoices) so
it never double-counts. suggestCostToDate sums commitment paidToDate.
deriveOriginalContract recovers the pre-CO contract from the best source.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Profit-fade watch — `flagWipRow` + `assertPeriodEditable` (TDD)

**Files:**
- Modify: `scripts/validate-wip.ts`
- Modify: `utils/wip.ts`

- [ ] **Step 1: Extend the validator (FIRST)**

In `scripts/validate-wip.ts`, add `flagWipRow` and `assertPeriodEditable` to the imports:

```typescript
import {
  computeWipRow,
  computeWipPortfolio,
  suggestCostToDate,
  suggestBilledToDate,
  sumApprovedChangeOrders,
  deriveOriginalContract,
  flagWipRow,
  assertPeriodEditable,
} from '../utils/wip';
```

Add these cases before the final summary `console.log`:

```typescript
// ── flagWipRow: profit fade (margin drops > 2 pts vs prior) ─────────────────
const prevHiMargin = computeWipRow({ ...base, totalEstimatedCost: 70000 }); // 0.30 margin
const curLoMargin  = computeWipRow({ ...base, totalEstimatedCost: 75000 }); // 0.25 margin
const fade = flagWipRow(curLoMargin, prevHiMargin);
expect('profit fade detected', fade.profitFade, true);
expect('profit fade produces a reason', fade.reasons.length > 0, true);

const steady = flagWipRow(baseRow, baseRow);
expect('no profit fade when margin steady', steady.profitFade, false);

// ── flagWipRow: billing swing (> 5% of revised contract) ────────────────────
const prevBalanced = computeWipRow({ ...base, billedToDate: 40000 }); // net 0
const curOverbill  = computeWipRow({ ...base, billedToDate: 55000 }); // overbilled 15000
const swing = flagWipRow(curOverbill, prevBalanced);
expect('billing swing detected', swing.billingSwing, true);

const smallSwing = flagWipRow(
  computeWipRow({ ...base, billedToDate: 41000 }), // overbilled 1000
  computeWipRow({ ...base, billedToDate: 40000 })); // net 0 → swing 1000 < 5000
expect('no billing swing under threshold', smallSwing.billingSwing, false);

// ── flagWipRow: schedule divergence (cost% vs EVM schedule% > 10 pts) ───────
const diverge = flagWipRow(baseRow, undefined, { schedulePercent: 0.65 }); // cost 0.40
expect('schedule divergence detected', diverge.scheduleDivergence, true);
const aligned = flagWipRow(baseRow, undefined, { schedulePercent: 0.45 });
expect('no divergence when aligned', aligned.scheduleDivergence, false);
expect('no divergence without EVM', flagWipRow(baseRow).scheduleDivergence, false);

// ── assertPeriodEditable: locked period is immutable ────────────────────────
expect('locked period blocked',
  assertPeriodEditable({ lockedAt: '2026-07-08T00:00:00.000Z' }).blocked, true);
expect('unlocked period editable',
  assertPeriodEditable({ lockedAt: undefined }).blocked, false);
```

- [ ] **Step 2: Run to verify new cases fail**

Run: `bun run scripts/validate-wip.ts`
Expected: FAIL — `flagWipRow` / `assertPeriodEditable` not exported.

- [ ] **Step 3: Implement the flag + guard functions**

Add `WipFlags` and `WipPeriod` to the type import at the top of `utils/wip.ts`:

```typescript
import type {
  WipRowInput, WipRow, WipPortfolio, WipSnapshotRow, WipFlags, WipPeriod,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project,
} from '@/types';
```

Append to the end of `utils/wip.ts`:

```typescript
// Thresholds for the profit-fade watch. Exported so the screen can reference
// the same constants in copy/tooltips.
export const WIP_PROFIT_FADE_THRESHOLD = 0.02;         // 2 margin points
export const WIP_BILLING_SWING_THRESHOLD = 0.05;       // 5% of revised contract
export const WIP_SCHEDULE_DIVERGENCE_THRESHOLD = 0.10; // 10 percentage points

/**
 * Classify a WIP row against the prior locked period and (optionally) EVM
 * schedule-% for early over/under-billing detection.
 */
export function flagWipRow(
  row: WipRow,
  prev?: WipRow,
  evm?: { schedulePercent: number },
): WipFlags {
  const reasons: string[] = [];
  let profitFade = false;
  let billingSwing = false;
  let scheduleDivergence = false;

  if (prev && row.estGrossMarginPct < prev.estGrossMarginPct - WIP_PROFIT_FADE_THRESHOLD) {
    profitFade = true;
    const dropPts = (prev.estGrossMarginPct - row.estGrossMarginPct) * 100;
    reasons.push(`Gross margin faded ${dropPts.toFixed(1)} pts vs prior period`);
  }

  if (prev && row.revisedContract > 0) {
    const netNow = row.overbilling - row.underbilling;
    const netPrev = prev.overbilling - prev.underbilling;
    if (Math.abs(netNow - netPrev) > WIP_BILLING_SWING_THRESHOLD * row.revisedContract) {
      billingSwing = true;
      reasons.push('Large swing in over/under-billing vs prior period');
    }
  }

  if (evm && Math.abs(row.percentComplete - evm.schedulePercent) > WIP_SCHEDULE_DIVERGENCE_THRESHOLD) {
    scheduleDivergence = true;
    const costPct = (row.percentComplete * 100).toFixed(0);
    const schedPct = (evm.schedulePercent * 100).toFixed(0);
    reasons.push(`Cost %-complete (${costPct}%) diverges from schedule (${schedPct}%)`);
  }

  return { profitFade, billingSwing, scheduleDivergence, reasons };
}

/**
 * Immutability guard, mirroring the invoice-immutability precedent. A locked
 * period must not be edited — callers route the user to "create a new period".
 */
export function assertPeriodEditable(
  period: Pick<WipPeriod, 'lockedAt'>,
): { blocked: boolean; reason?: string } {
  if (period.lockedAt) {
    return { blocked: true, reason: 'This period is locked. Create a new period instead.' };
  }
  return { blocked: false };
}
```

- [ ] **Step 4: Run to verify all cases pass**

Run: `bun run scripts/validate-wip.ts`
Expected: PASS — `N passed, 0 failed`.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add utils/wip.ts scripts/validate-wip.ts
git commit -m "$(cat <<'EOF'
wip: profit-fade watch (flagWipRow) + locked-period guard

flagWipRow classifies profit fade, billing swing, and cost-vs-EVM schedule
divergence against a prior period. assertPeriodEditable blocks edits to a
locked snapshot.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `WipContext` — snapshot collection + persistence

Owns `tertiary_wip_periods`: hydrate from AsyncStorage, persist locally, and mirror to Supabase via `supabaseWrite`. `lockPeriod` and `updatePeriod` enforce lock-immutability using the engine's guard.

**Files:**
- Create: `contexts/WipContext.tsx`
- Modify: `app/_layout.tsx` (mount `<WipProvider>` inside `<ProjectProvider>`)

- [ ] **Step 1: Create the context**

Create `contexts/WipContext.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { generateUUID } from '@/utils/generateId';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { assertPeriodEditable } from '@/utils/wip';
import type { WipPeriod, WipSnapshotRow, WipPortfolio } from '@/types';

const WIP_PERIODS_KEY = 'tertiary_wip_periods';

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Maps a WipPeriod to the snake_case wip_periods row shape. rows/portfolio are
// stored as JSONB; supabase-js serializes the objects for the jsonb columns.
function toRow(p: WipPeriod, userId: string | undefined) {
  return {
    id: p.id,
    user_id: userId ?? null,
    company_id: p.companyId ?? null,
    period_end_date: p.periodEndDate,
    rows: p.rows,
    portfolio_totals: p.portfolioTotals,
    notes: p.notes ?? null,
    locked_at: p.lockedAt ?? null,
    created_by: p.createdBy ?? null,
    created_at: p.createdAt,
  };
}

export const [WipProvider, useWip] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id;
  const [periods, setPeriods] = useState<WipPeriod[]>([]);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadLocal<WipPeriod[]>(WIP_PERIODS_KEY, []);
      if (cancelled) return;
      if (Array.isArray(stored)) {
        setPeriods(stored.filter((p) => p && typeof p.id === 'string'));
      }
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (next: WipPeriod[]) => {
    setPeriods(next);
    try { await AsyncStorage.setItem(WIP_PERIODS_KEY, JSON.stringify(next)); }
    catch { /* AsyncStorage failure is non-fatal for in-memory state */ }
  }, []);

  const addPeriod = useCallback((input: {
    periodEndDate: string;
    rows: WipSnapshotRow[];
    portfolioTotals: WipPortfolio;
    notes?: string;
    companyId?: string;
  }): WipPeriod => {
    const now = new Date().toISOString();
    const period: WipPeriod = {
      id: generateUUID(),
      createdAt: now,
      createdBy: userId,
      periodEndDate: input.periodEndDate,
      rows: input.rows,
      portfolioTotals: input.portfolioTotals,
      notes: input.notes,
      companyId: input.companyId,
    };
    void persist([period, ...periods]);
    if (userId) void supabaseWrite('wip_periods', 'insert', toRow(period, userId));
    return period;
  }, [periods, persist, userId]);

  const lockPeriod = useCallback((id: string): boolean => {
    const target = periods.find((p) => p.id === id);
    if (!target || target.lockedAt) return false;
    const lockedAt = new Date().toISOString();
    void persist(periods.map((p) => (p.id === id ? { ...p, lockedAt } : p)));
    if (userId) void supabaseWrite('wip_periods', 'update', { id, locked_at: lockedAt });
    return true;
  }, [periods, persist, userId]);

  const updatePeriod = useCallback((
    id: string,
    updates: Partial<Pick<WipPeriod, 'rows' | 'portfolioTotals' | 'notes'>>,
  ): boolean => {
    const target = periods.find((p) => p.id === id);
    if (!target) return false;
    if (assertPeriodEditable(target).blocked) return false; // locked → immutable
    const merged: WipPeriod = { ...target, ...updates };
    void persist(periods.map((p) => (p.id === id ? merged : p)));
    if (userId) {
      void supabaseWrite('wip_periods', 'update', {
        id,
        rows: merged.rows,
        portfolio_totals: merged.portfolioTotals,
        notes: merged.notes ?? null,
      });
    }
    return true;
  }, [periods, persist, userId]);

  return { periods, addPeriod, lockPeriod, updatePeriod };
});
```

- [ ] **Step 2: Mount the provider in `app/_layout.tsx`**

Add the import near the other context imports:

```tsx
import { WipProvider } from '@/contexts/WipContext';
```

Then wrap `<PropertyProvider>` (the first child of `<ProjectProvider>`) with `<WipProvider>` — change:

```tsx
            <ProjectProvider>
              <PropertyProvider>
```

to:

```tsx
            <ProjectProvider>
              <WipProvider>
              <PropertyProvider>
```

and add the matching close tag — change:

```tsx
              </PropertyProvider>
            </ProjectProvider>
```

to:

```tsx
              </PropertyProvider>
              </WipProvider>
            </ProjectProvider>
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: PASS (provider is mounted below Auth so `useAuth()` resolves; no unbalanced JSX).

- [ ] **Step 4: Commit**

```bash
git add contexts/WipContext.tsx app/_layout.tsx
git commit -m "$(cat <<'EOF'
wip: WipContext for period snapshots (offline-safe, lock-immutable)

Owns tertiary_wip_periods with AsyncStorage hydration + supabaseWrite mirroring.
lockPeriod/updatePeriod enforce lock-immutability via assertPeriodEditable.
Mounted inside ProjectProvider.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The `wip-report` screen

Portfolio WIP table over active projects, per-project drill-in modal (editable cost-to-date seeded from the suggestion, live-computed outputs), period selector, Lock action, and Export PDF/CSV. Business+ gated.

**Files:**
- Create: `app/wip-report.tsx`

- [ ] **Step 1: Create the screen**

Create `app/wip-report.tsx`:

```tsx
import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  Platform, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, TrendingUp, Lock, FileSpreadsheet, X, AlertTriangle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

import { useProjects } from '@/contexts/ProjectContext';
import { useWip } from '@/contexts/WipContext';
import {
  computeWipRow, computeWipPortfolio, flagWipRow,
  suggestCostToDate, suggestBilledToDate, sumApprovedChangeOrders, deriveOriginalContract,
} from '@/utils/wip';
import { wipPeriodToCSV, shareWipPeriodPdf } from '@/utils/wipExport';
import { copyToClipboard } from '@/utils/clipboard';
import type { WipRowInput, WipSnapshotRow, Project } from '@/types';

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export default function WipReportScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('wip_reporting')) {
    return (
      <Paywall
        visible={true}
        feature="WIP Reporting"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <WipReportScreenInner />;
}

function WipReportScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const {
    projects,
    getChangeOrdersForProject,
    getCommitmentsForProject,
    getInvoicesForProject,
    getAIAPayAppsForProject,
  } = useProjects();
  const { periods, addPeriod, lockPeriod } = useWip();

  // Per-project cost-to-date overrides (keyed by project id).
  const [costOverrides, setCostOverrides] = useState<Record<string, number>>({});
  const [drillProjectId, setDrillProjectId] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  const activeProjects: Project[] = useMemo(
    () => projects.filter((p) => !p.archived),
    [projects],
  );

  // Build a live WIP input for one project from existing collections.
  const buildInput = useCallback((project: Project): WipRowInput => {
    const cos = getChangeOrdersForProject(project.id);
    const commitments = getCommitmentsForProject(project.id);
    const invoices = getInvoicesForProject(project.id);
    const payApps = getAIAPayAppsForProject(project.id);
    const suggestedCost = suggestCostToDate(commitments);
    return {
      originalContract: deriveOriginalContract(project, cos, payApps),
      approvedChangeOrders: sumApprovedChangeOrders(cos),
      totalEstimatedCost: project.targetBudget?.amount ?? 0,
      costToDate: costOverrides[project.id] ?? suggestedCost,
      billedToDate: suggestBilledToDate(invoices, payApps),
    };
  }, [costOverrides, getChangeOrdersForProject, getCommitmentsForProject, getInvoicesForProject, getAIAPayAppsForProject]);

  const liveRows: WipSnapshotRow[] = useMemo(
    () => activeProjects.map((p) => {
      const input = buildInput(p);
      return { projectId: p.id, projectName: p.name, input, output: computeWipRow(input) };
    }),
    [activeProjects, buildInput],
  );

  const portfolio = useMemo(() => computeWipPortfolio(liveRows), [liveRows]);

  // Prior locked period, for the profit-fade watch.
  const priorPeriod = useMemo(
    () => periods.filter((p) => p.lockedAt)
      .sort((a, b) => b.periodEndDate.localeCompare(a.periodEndDate))[0],
    [periods],
  );

  const drillProject = activeProjects.find((p) => p.id === drillProjectId) ?? null;
  const drillInput = drillProject ? buildInput(drillProject) : null;
  const drillOutput = drillInput ? computeWipRow(drillInput) : null;
  const drillPriorRow = priorPeriod?.rows.find((r) => r.projectId === drillProjectId)?.output;
  const drillFlags = drillOutput ? flagWipRow(drillOutput, drillPriorRow) : null;

  const handleSnapshot = useCallback(() => {
    const periodEndDate = new Date().toISOString().slice(0, 10);
    addPeriod({ periodEndDate, rows: liveRows, portfolioTotals: portfolio });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Period saved', `WIP snapshot for ${periodEndDate} created. Lock it to freeze for CPA/bank review.`);
  }, [addPeriod, liveRows, portfolio]);

  const handleLock = useCallback(() => {
    const target = selectedPeriodId ? periods.find((p) => p.id === selectedPeriodId) : periods[0];
    if (!target) { Alert.alert('No period', 'Save a period snapshot first, then lock it.'); return; }
    if (target.lockedAt) { Alert.alert('Already locked', 'This period is immutable. Create a new period to make changes.'); return; }
    Alert.alert('Lock period?', `Locking freezes ${target.periodEndDate}. It can no longer be edited.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lock', style: 'destructive', onPress: () => { lockPeriod(target.id); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } },
    ]);
  }, [selectedPeriodId, periods, lockPeriod]);

  const exportPeriod = useMemo(() => {
    if (selectedPeriodId) return periods.find((p) => p.id === selectedPeriodId) ?? null;
    // Fall back to a live (unsaved) period shape for export.
    return {
      id: 'live', periodEndDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(), rows: liveRows, portfolioTotals: portfolio,
    };
  }, [selectedPeriodId, periods, liveRows, portfolio]);

  const handleExportCsv = useCallback(async () => {
    if (!exportPeriod) return;
    const csv = wipPeriodToCSV(exportPeriod);
    const ok = await copyToClipboard(csv);
    if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(ok ? 'CSV copied' : 'Copy failed', ok ? 'Paste into Excel / QuickBooks / Sage.' : 'Could not copy CSV.');
  }, [exportPeriod]);

  const handleExportPdf = useCallback(async () => {
    if (!exportPeriod) return;
    try { await shareWipPeriodPdf(exportPeriod, 'MAGE ID'); }
    catch { Alert.alert('Export failed', 'Could not generate the WIP PDF.'); }
  }, [exportPeriod]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Financial Reporting</Text>
          <Text style={styles.title}>WIP Report</Text>
        </View>
        <TrendingUp size={22} color={themeColors.accent} strokeWidth={1.75} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        {/* Portfolio totals */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Portfolio</Text>
          <Row label="Revised contract" value={money(portfolio.revisedContract)} styles={styles} />
          <Row label="Earned revenue" value={money(portfolio.earnedRevenue)} styles={styles} />
          <Row label="Billed to date" value={money(portfolio.billedToDate)} styles={styles} />
          <Row label="Overbilling" value={money(portfolio.overbilling)} styles={styles} />
          <Row label="Underbilling" value={money(portfolio.underbilling)} styles={styles} />
          <Row label="Backlog" value={money(portfolio.backlog)} styles={styles} />
          <Row label="Weighted margin" value={pct(portfolio.weightedMarginPct)} styles={styles} />
        </View>

        {/* Period selector */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Periods</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <TouchableOpacity
              style={[styles.periodChip, selectedPeriodId === null && styles.periodChipActive]}
              onPress={() => setSelectedPeriodId(null)}>
              <Text style={styles.periodChipText}>Live</Text>
            </TouchableOpacity>
            {periods.map((p) => (
              <TouchableOpacity key={p.id}
                style={[styles.periodChip, selectedPeriodId === p.id && styles.periodChipActive]}
                onPress={() => setSelectedPeriodId(p.id)}>
                {p.lockedAt ? <Lock size={12} color={themeColors.textMuted} strokeWidth={2} /> : null}
                <Text style={styles.periodChipText}>{p.periodEndDate}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleSnapshot}>
              <Text style={styles.actionBtnText}>Save period</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleLock}>
              <Lock size={14} color={themeColors.text} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Lock</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleExportCsv}>
              <FileSpreadsheet size={14} color={themeColors.text} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Export CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleExportPdf}>
              <Text style={styles.actionBtnText}>Export PDF</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Per-project rows (live) */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Projects</Text>
          {liveRows.length === 0 ? (
            <Text style={styles.muted}>No active projects.</Text>
          ) : liveRows.map((r) => {
            const prior = priorPeriod?.rows.find((pr) => pr.projectId === r.projectId)?.output;
            const flags = flagWipRow(r.output, prior);
            const flagged = flags.profitFade || flags.billingSwing || flags.scheduleDivergence;
            return (
              <TouchableOpacity key={r.projectId} style={styles.projectRow} onPress={() => setDrillProjectId(r.projectId)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName}>{r.projectName}</Text>
                  <Text style={styles.muted}>{pct(r.output.percentComplete)} complete · {money(r.output.earnedRevenue)} earned</Text>
                </View>
                {flagged ? <AlertTriangle size={16} color={themeColors.danger} strokeWidth={2} /> : null}
                <Text style={r.output.overbilling > 0 ? styles.over : styles.under}>
                  {r.output.overbilling > 0 ? `Over ${money(r.output.overbilling)}` : `Under ${money(r.output.underbilling)}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Per-project drill-in modal */}
      <Modal visible={drillProjectId !== null} transparent animationType="slide" onRequestClose={() => setDrillProjectId(null)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }} keyboardShouldPersistTaps="handled">
            <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>{drillProject?.name ?? 'Project'}</Text>
                <TouchableOpacity onPress={() => setDrillProjectId(null)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              {drillInput && drillOutput ? (
                <>
                  <Text style={styles.muted}>Cost-to-date (suggested, editable)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    defaultValue={String(drillInput.costToDate)}
                    placeholder="0"
                    placeholderTextColor={themeColors.textMuted}
                    onEndEditing={(e) => {
                      const v = Number(e.nativeEvent.text.replace(/[^0-9.]/g, ''));
                      if (drillProjectId) setCostOverrides((prev) => ({ ...prev, [drillProjectId]: Number.isFinite(v) ? v : 0 }));
                    }}
                  />
                  <Row label="Revised contract" value={money(drillOutput.revisedContract)} styles={styles} />
                  <Row label="% complete" value={pct(drillOutput.percentComplete)} styles={styles} />
                  <Row label="Earned revenue" value={money(drillOutput.earnedRevenue)} styles={styles} />
                  <Row label="Overbilling" value={money(drillOutput.overbilling)} styles={styles} />
                  <Row label="Underbilling" value={money(drillOutput.underbilling)} styles={styles} />
                  <Row label="Est gross profit" value={money(drillOutput.estGrossProfit)} styles={styles} />
                  <Row label="Est gross margin" value={pct(drillOutput.estGrossMarginPct)} styles={styles} />
                  <Row label="Profit to date" value={money(drillOutput.profitToDate)} styles={styles} />
                  <Row label="Cost to complete" value={money(drillOutput.costToComplete)} styles={styles} />
                  <Row label="Backlog" value={money(drillOutput.backlog)} styles={styles} />
                  {drillFlags && drillFlags.reasons.length > 0 ? (
                    <View style={styles.flagBox}>
                      {drillFlags.reasons.map((reason) => (
                        <View key={reason} style={styles.flagRow}>
                          <AlertTriangle size={14} color={themeColors.danger} strokeWidth={2} />
                          <Text style={styles.flagText}>{reason}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: t.bg, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontWeight: '600' as const },
  title: { fontSize: Type.title2.fontSize, color: t.text, fontWeight: '700' as const },
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: t.line, gap: 6,
  },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 8 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  dataLabel: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  dataValue: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  muted: { fontSize: Type.footnote.fontSize, color: t.textMuted },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  projectName: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  over: { fontSize: Type.footnote.fontSize, color: t.danger, fontWeight: '700' as const },
  under: { fontSize: Type.footnote.fontSize, color: t.info, fontWeight: '700' as const },
  periodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  periodChipActive: { borderColor: t.accent, backgroundColor: t.accentSoft },
  periodChipText: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  actionBtnText: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  formCard: {
    backgroundColor: t.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 22, gap: 6,
  },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  input: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 10, color: t.text, fontSize: Type.body.fontSize, marginBottom: 8,
  },
  flagBox: { marginTop: 10, gap: 6 },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flagText: { fontSize: Type.footnote.fontSize, color: t.danger, flex: 1 },
});
```

> If `Project` has no `archived` field, replace `projects.filter((p) => !p.archived)` with `projects` and drop the filter — verify against `types/index.ts` at implementation time; the type-check in Step 3 will catch a wrong field name.

- [ ] **Step 2: Register the screen in `app/_layout.tsx`**

Add inside the `<Stack>` in `RootLayoutNav()`, alongside the other financial screens (e.g. right after the `budget-dashboard` / `invoice` entries):

```tsx
        <Stack.Screen name="wip-report" options={{ title: 'WIP Report' }} />
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: PASS. If tsc flags `p.archived` or `p.targetBudget?.amount`, correct to the real `Project` field names and re-run.

- [ ] **Step 4: Commit**

```bash
git add app/wip-report.tsx app/_layout.tsx
git commit -m "$(cat <<'EOF'
wip: WIP report screen (portfolio + drill-in + lock + export)

Portfolio roll-up, per-project rows with profit-fade badges, editable
cost-to-date drill-in with live-computed outputs, period selector, Lock, and
CSV/PDF export. Business+ gated via Paywall.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: PDF / CSV export (`utils/wipExport.ts`) with a CSV validator case

**Files:**
- Create: `utils/wipExport.ts`
- Modify: `scripts/validate-wip.ts` (add a CSV smoke case)

- [ ] **Step 1: Add a failing CSV validator case (FIRST)**

In `scripts/validate-wip.ts`, add to the imports:

```typescript
import { wipPeriodToCSV } from '../utils/wipExport';
import type { WipPeriod } from '../types';
```

Add before the final summary `console.log`:

```typescript
// ── wipPeriodToCSV: header + one row + TOTAL line ───────────────────────────
const csvPeriod: WipPeriod = {
  id: 'p1', periodEndDate: '2026-07-08', createdAt: '2026-07-08T00:00:00.000Z',
  rows: [{ projectId: 'a', projectName: 'Alpha, LLC', input: base, output: baseRow }],
  portfolioTotals: computeWipPortfolio([{ projectId: 'a', projectName: 'Alpha, LLC', input: base, output: baseRow }]),
};
const csv = wipPeriodToCSV(csvPeriod);
const csvLines = csv.split('\n');
expect('CSV has header + 1 row + TOTAL', csvLines.length, 3);
expect('CSV header first column', csvLines[0].split(',')[0], 'Project');
expect('CSV quotes commas in project name', csvLines[1].startsWith('"Alpha, LLC"'), true);
expect('CSV last line is TOTAL', csvLines[2].startsWith('TOTAL'), true);
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run scripts/validate-wip.ts`
Expected: FAIL — `Cannot find module '../utils/wipExport'`.

- [ ] **Step 3: Implement the exporter**

Create `utils/wipExport.ts`:

```tsx
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { WipPeriod, WipSnapshotRow } from '@/types';

const CSV_COLUMNS = [
  'Project', 'Revised Contract', 'Total Est Cost', 'Cost to Date', '% Complete',
  'Earned Revenue', 'Billed to Date', 'Overbilling', 'Underbilling',
  'Est Gross Profit', 'Backlog',
];

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Pure CSV builder — CPA/QuickBooks-pasteable WIP schedule. */
export function wipPeriodToCSV(period: WipPeriod): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const r of period.rows) {
    lines.push([
      r.projectName,
      Math.round(r.output.revisedContract),
      Math.round(r.input.totalEstimatedCost),
      Math.round(r.input.costToDate),
      (r.output.percentComplete * 100).toFixed(1),
      Math.round(r.output.earnedRevenue),
      Math.round(r.input.billedToDate),
      Math.round(r.output.overbilling),
      Math.round(r.output.underbilling),
      Math.round(r.output.estGrossProfit),
      Math.round(r.output.backlog),
    ].map(csvCell).join(','));
  }
  const t = period.portfolioTotals;
  lines.push([
    'TOTAL', Math.round(t.revisedContract), Math.round(t.totalEstimatedCost),
    Math.round(t.costToDate), '', Math.round(t.earnedRevenue), Math.round(t.billedToDate),
    Math.round(t.overbilling), Math.round(t.underbilling),
    Math.round(t.revisedContract - t.totalEstimatedCost), Math.round(t.backlog),
  ].map(csvCell).join(','));
  return lines.join('\n');
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function htmlRow(r: WipSnapshotRow): string {
  return `<tr>
    <td class="l">${escapeHtml(r.projectName)}</td>
    <td>${money(r.output.revisedContract)}</td>
    <td>${money(r.input.totalEstimatedCost)}</td>
    <td>${money(r.input.costToDate)}</td>
    <td>${(r.output.percentComplete * 100).toFixed(0)}%</td>
    <td>${money(r.output.earnedRevenue)}</td>
    <td>${money(r.input.billedToDate)}</td>
    <td>${money(r.output.overbilling)}</td>
    <td>${money(r.output.underbilling)}</td>
    <td>${money(r.output.estGrossProfit)}</td>
    <td>${money(r.output.backlog)}</td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** CPA-style WIP schedule HTML for PDF export. */
export function buildWipHtml(period: WipPeriod, companyName: string): string {
  const t = period.portfolioTotals;
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 24px; }
    h1 { font-size: 20px; margin: 0; }
    .sub { color: #666; font-size: 12px; margin: 4px 0 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { border: 1px solid #ddd; padding: 5px 6px; text-align: right; }
    th { background: #f4f1ea; }
    td.l, th.l { text-align: left; }
    tfoot td { font-weight: 700; background: #faf7f0; }
  </style></head><body>
    <h1>${escapeHtml(companyName)} — Work-In-Progress Schedule</h1>
    <div class="sub">As of ${escapeHtml(period.periodEndDate)}${period.lockedAt ? ' · LOCKED' : ''}</div>
    <table>
      <thead><tr>
        <th class="l">Project</th><th>Revised Contract</th><th>Est Cost</th><th>Cost to Date</th>
        <th>% Comp</th><th>Earned Rev</th><th>Billed</th><th>Overbill</th><th>Underbill</th>
        <th>Est GP</th><th>Backlog</th>
      </tr></thead>
      <tbody>${period.rows.map(htmlRow).join('')}</tbody>
      <tfoot><tr>
        <td class="l">TOTAL</td><td>${money(t.revisedContract)}</td><td>${money(t.totalEstimatedCost)}</td>
        <td>${money(t.costToDate)}</td><td></td><td>${money(t.earnedRevenue)}</td><td>${money(t.billedToDate)}</td>
        <td>${money(t.overbilling)}</td><td>${money(t.underbilling)}</td>
        <td>${money(t.revisedContract - t.totalEstimatedCost)}</td><td>${money(t.backlog)}</td>
      </tr></tfoot>
    </table>
  </body></html>`;
}

/** Render + share the WIP schedule as a PDF (mirrors financialReportPdf). */
export async function shareWipPeriodPdf(period: WipPeriod, companyName: string): Promise<void> {
  const html = buildWipHtml(period, companyName);
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `WIP Report ${period.periodEndDate}`, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
```

- [ ] **Step 4: Run to verify all cases pass**

Run: `bun run scripts/validate-wip.ts`
Expected: PASS — `N passed, 0 failed` (including the three CSV cases).

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add utils/wipExport.ts scripts/validate-wip.ts
git commit -m "$(cat <<'EOF'
wip: PDF + CSV export for the WIP schedule

Pure wipPeriodToCSV (CPA/QuickBooks-pasteable, CSV-escaped) + buildWipHtml and
shareWipPeriodPdf via expo-print/sharing, mirroring financialReportPdf.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Tier gating, nav registration, and migration

**Files:**
- Modify: `hooks/useTierAccess.ts`
- Modify: `components/DesktopSidebar.tsx`
- Create: `supabase/migrations/20260708120000_wip_periods.sql`
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Add the `wip_reporting` feature key (Business+)**

In `hooks/useTierAccess.ts`, add to the `FeatureKey` union under the Business-only block:

```typescript
  | 'rfis_submittals'
  | 'full_budget_dashboard'
  | 'wip_reporting'
```

And add the matching entry to `REQUIRED_TIER` under the Business-only block:

```typescript
  full_budget_dashboard: 'business',
  wip_reporting: 'business',
```

(TypeScript enforces `Record<FeatureKey, …>` exhaustiveness, so both edits are required together.)

- [ ] **Step 2: Type-check + gating validator**

Run: `npx tsc --noEmit && bun run test:gating`
Expected: PASS (the `Record` stays exhaustive; the activation-gating validator still passes).

- [ ] **Step 3: Add the sidebar nav entry**

In `components/DesktopSidebar.tsx`, ensure `TrendingUp` is imported from `lucide-react-native` (add it if absent). Then add to the `FINANCIALS` section, after the `budget-dashboard` entry:

```typescript
  { key: 'wip-report',        label: 'WIP Report',       icon: TrendingUp,      route: '/wip-report',                       section: 'FINANCIALS', requires: 'wip_reporting' },
```

- [ ] **Step 4: Create the migration**

Create `supabase/migrations/20260708120000_wip_periods.sql`:

```sql
-- WIP Reporting: additive period-snapshot table.
-- Live WIP is computed on the fly from existing financial tables; only these
-- frozen snapshots persist. locked_at makes a period immutable at the app
-- layer (CPA/bank close). Scoped by user_id (matches every tertiary_* table);
-- company_id is stored for future company-wide roll-ups but RLS is on user_id.
CREATE TABLE IF NOT EXISTS public.wip_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT,
  period_end_date TEXT NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  locked_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wip_periods_user ON public.wip_periods(user_id);

CREATE TRIGGER wip_periods_updated_at BEFORE UPDATE ON public.wip_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.wip_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wip_periods_select_own" ON public.wip_periods
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wip_periods_insert_own" ON public.wip_periods
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wip_periods_update_own" ON public.wip_periods
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "wip_periods_delete_own" ON public.wip_periods
  FOR DELETE USING (auth.uid() = user_id);
```

> Reconciliation with the spec's "company-scoped": every existing `tertiary_*` table scopes by `user_id` (see `punch_items`), and RLS uses `auth.uid() = user_id`. This plan follows that established precedent for consistency and RLS correctness, and keeps `company_id` as a stored column so a future company-wide policy can be layered on without a data migration.

- [ ] **Step 5: Mirror into `supabase/schema.sql`**

Append the same `CREATE TABLE`, index, trigger, `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, and four policies to `supabase/schema.sql` (place the table near the other `tertiary_*` tables and the policies alongside the other `_select_own` / `_insert_own` policies, matching the file's existing organization).

- [ ] **Step 6: Full ship-check**

Run: `bun run ship-check`
Expected: PASS — typecheck, lint, all validators including `test:wip`.

- [ ] **Step 7: Commit**

```bash
git add hooks/useTierAccess.ts components/DesktopSidebar.tsx supabase/migrations/20260708120000_wip_periods.sql supabase/schema.sql
git commit -m "$(cat <<'EOF'
wip: Business+ gate, sidebar nav, and wip_periods migration

Adds the wip_reporting FeatureKey (Business+), the FINANCIALS sidebar entry,
and the additive wip_periods table (RLS, user-scoped, JSONB snapshot rows).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Apply the migration (owner-gated — do NOT `db push`)**

The `wip_periods` table must exist in production **before** the OTA that ships this code, or `supabaseWrite('wip_periods', …)` returns a `PGRST204` (unknown table) and snapshots silently fail to sync. Apply via the Supabase MCP `apply_migration` against project `nteoqhcswappxxjlpvap` (the memory-noted apply procedure), then verify with `execute_sql` (`SELECT * FROM public.wip_periods LIMIT 1;`). This step is owner-gated — surface it to the user; never run `supabase db push` (divergent history).

---

## Optional (light) follow-up: AI "explain flag"

Not required for v1. If added: in the drill-in modal, an "Explain" affordance calls the existing text relay, metered through `checkAILimit(tier, 'text', 'wip_explain')` before the call and `recordAIUsage('text', 'wip_explain')` after success (`utils/aiRateLimiter.ts`). Server-side, any such relay already runs behind `requireTier(req, ['business'], 'wip_reporting')`. Keep it optional — the `flagWipRow` `reasons[]` strings already give the user a deterministic, offline explanation without an AI call.

---

## Self-Review (completed against the spec)

**Spec coverage:** revised contract, %-complete (override + `totalEstimatedCost===0` guard + cap at 1) → Task 2/3; earned revenue, over/under-billing (mutually exclusive, ≥0) → Task 2; estGrossProfit/Margin, profitToDate, costToComplete, backlog → Task 2; portfolio roll-up + weighted margin → Task 2; cost-to-date auto-suggest + editable → Task 3 (`suggestCostToDate`) + Task 6 (drill-in override); billed-to-date single-source (no double count) → Task 3 (`suggestBilledToDate`); profit-fade / billing-swing / EVM-divergence flags → Task 4; snapshot collection + lock-immutability → Task 5 (`WipContext` + `assertPeriodEditable`); screen (portfolio table, drill-in, period selector, Lock, Export) → Task 6; PDF/CSV export → Task 7; tier gate (Business+) + nav + migration + schema + PGRST204 apply-before-OTA → Task 8; validator wired into ship-check → Task 2 Step 5.

**Placeholder scan:** none — every code step contains complete, runnable code; every command has an expected result.

**Type consistency:** `computeWipRow`, `computeWipPortfolio`, `flagWipRow`, `assertPeriodEditable`, `suggestCostToDate(commitments)`, `suggestBilledToDate(invoices, payApps)`, `sumApprovedChangeOrders`, `deriveOriginalContract`, `wipPeriodToCSV`, `shareWipPeriodPdf`, and the six `Wip*` types are used with identical signatures across the validator, context, screen, and exporter. The new `Wip*` type names are deliberately distinct from the pre-existing `WIPReport` in `utils/financialReportPdf.ts`/`app/reports.tsx` to avoid collision.

**Known field-name checks deferred to type-check:** `Project.archived`, `Project.targetBudget.amount`, `SavedAIAPayApp.totals.currentPaymentDue`, `Commitment.paidToDate`, `ChangeOrder.changeAmount/originalContractValue/status==='approved'`, `Invoice.totalDue`, and `useProjects()` exposing the four `get…ForProject` getters — all sourced from `types/index.ts` / `contexts/ProjectContext.tsx` during exploration; `npx tsc --noEmit` (run in Tasks 5/6/7/8) is the backstop if any differ.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-wip-reporting.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
