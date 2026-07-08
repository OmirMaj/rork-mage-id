# WIP Reporting — Design Spec

**Goal:** Generate the Work-In-Progress (WIP) schedule that CPAs, banks, and sureties require — per-project and portfolio — with revised contract, cost-to-date, % complete, earned revenue, and over/under-billing, plus a profit-fade watch that leverages MAGE's existing EVM. Closes the WIP gap vs JACK App.

**Architecture:** WIP is *mostly a computed report*, so the core is a **pure engine** (`utils/wip.ts`) that takes explicit inputs and returns a fully computed WIP row — no side effects, trivially testable. On top sits a **period-snapshot** collection (`tertiary_wip_periods`) that freezes a point-in-time WIP so a locked period-end is immutable (CPAs/banks need WIP that doesn't move after close). A thin `WipContext` (or a screen-local hook, since data is derived) reads existing project financial data, auto-suggests cost-to-date, and lets the user override before locking.

**Tech stack:** React Native / Expo (OTA-safe — no native deps), Supabase (RLS table + offline queue), `expo-print` for PDF export, themed styles, lucide icons, amber brand. Reuses `contractValue`, change orders, budget, invoices, AIA pay-apps, and EVM (SPI/CPI).

---

## Scope (v1 = Full WIP schedule; cost-to-date = auto-suggest, editable)

Per-project WIP row + portfolio roll-up + period snapshot/lock + PDF/CSV export + profit-fade flags.

---

## The WIP engine (`utils/wip.ts` — pure)

**Input** (`WipRowInput`):
- `originalContract: number` — from `contractValue` / `originalContractValue`
- `approvedChangeOrders: number` — Σ approved `tertiary_change_orders`
- `totalEstimatedCost: number` — current cost budget (budget-dashboard / estimate)
- `costToDate: number` — **auto-suggested, user-editable** (see below)
- `billedToDate: number` — Σ billings for the project. **Avoid double-counting:** a project bills via *either* standard invoices *or* AIA pay-apps (a pay-app is itself the invoice). The engine takes a single `billedToDate`; `suggestBilledToDate(project)` picks the project's active billing source (pay-apps if any exist for the project, else invoices) rather than summing both, and the value is user-editable.
- `percentCompleteOverride?: number` — optional manual %

**Output** (`WipRow`), computed:
- `revisedContract = originalContract + approvedChangeOrders`
- `percentComplete = override ?? clamp(costToDate / totalEstimatedCost, 0, 1)` (guard `totalEstimatedCost === 0` → 0)
- `earnedRevenue = revisedContract * percentComplete`
- `overbilling = max(0, billedToDate − earnedRevenue)`
- `underbilling = max(0, earnedRevenue − billedToDate)`
- `estGrossProfit = revisedContract − totalEstimatedCost`
- `estGrossMarginPct = revisedContract === 0 ? 0 : estGrossProfit / revisedContract`
- `profitToDate = earnedRevenue − costToDate`
- `costToComplete = max(0, totalEstimatedCost − costToDate)`
- `backlog = revisedContract − earnedRevenue`

**Portfolio roll-up** (`computeWipPortfolio(rows)`): sums of revisedContract, earnedRevenue, billed, over/under-billing, backlog, and weighted margin.

---

## Cost-to-date: auto-suggest, editable

`utils/wip.ts` exposes `suggestCostToDate(project)` deriving a starting figure from:
- Σ `tertiary_commitments` recorded as incurred + Σ approved change-order costs + any logged actuals.

The WIP screen seeds `costToDate` with this suggestion, shows the breakdown, and lets the user **override per period** (the override is what gets snapshotted). If MAGE has no cost actuals for a project, the field starts at 0 and prompts manual entry — never silently wrong.

---

## Profit-fade watch (the differentiator — reuses EVM)

`utils/wip.ts` `flagWipRow(row, prev?, evm?)` returns flags:
- **Profit fade** — `estGrossMarginPct` dropped vs the previous locked period beyond a threshold.
- **Billing swing** — large change in over/under-billing vs prior period.
- **Cost vs schedule divergence** — cost-based `percentComplete` vs EVM **schedule-%/SPI** (`app/schedule-pro.tsx` / budget-dashboard) diverging → early over/under-billing signal.
These render as inline badges; an optional AI one-liner explains the flag using the existing text relay (metered) — no new heavy AI fn required.

---

## Data model

### `WipPeriod` — collection `tertiary_wip_periods` (company-scoped)
- `id`, `periodEndDate: string`, `createdAt`, `createdBy`
- `rows: WipSnapshotRow[]` — frozen per-project inputs + computed outputs + project name/id
- `portfolioTotals: WipPortfolio`
- `notes?: string`
- `lockedAt?: string` — when set, the period is **immutable** (reuses the invoice-immutability precedent: editing a locked period is blocked; create a new period instead).

Live (unlocked) WIP is computed on the fly from current project data; only snapshots are persisted.

---

## Integration points

- **Budget-dashboard / EVM** (`app/budget-dashboard.tsx`, `app/schedule-pro.tsx`) — cost budget + SPI/schedule-% feed the engine and the divergence flag.
- **Change orders** (`tertiary_change_orders`) — approved → revised contract.
- **Invoices + AIA pay-apps** (`app/invoice.tsx`, `tertiary_aia_pay_apps`) — billed-to-date.
- **Commitments** (`tertiary_commitments`) — cost-to-date suggestion.
- **Export** — PDF (CPA-style WIP schedule) via `expo-print`; CSV via the existing report-export path (`app/reports.tsx`).
- **Tier gating** — **Business+** (financial reporting): client gate `hooks/useTierAccess.ts`, server gate on any AI explain call.

---

## Screen

- **`app/wip-report.tsx`** — portfolio WIP table (active projects × the schedule columns), per-project drill-in (input panel with the cost-to-date suggestion + override, live-computed outputs), period selector, **Lock period** action, and **Export PDF/CSV**. Follows the `reports.tsx` / `budget-dashboard.tsx` layout + modal-in-screen conventions. Register in `app/_layout.tsx`; add to `DesktopSidebar`/nav behind the Business gate. Icons: lucide (`TrendingUp`, `Lock`, `FileSpreadsheet`).

---

## Error handling / offline

- Snapshot writes via `supabaseWrite` (offline-safe). Live WIP is read-only computation over already-synced data.
- Locked periods immutable (guard on `lockedAt`); attempts to edit route to "create new period".
- Divide-by-zero guards in the engine (zero est-cost, zero contract) return 0, never NaN.

---

## Migrations (additive, owner-applied via Supabase MCP — never `db push`)

One additive table `wip_periods` (company-scoped, RLS) storing the JSON snapshot rows + totals + `locked_at`. Update `supabase/schema.sql` in the same change. No changes to existing financial tables (WIP only reads them).

---

## Testing (pure-fn validators — no jest — wired into `ship-check`)

- `scripts/validate-wip.ts` against `utils/wip.ts`:
  - revised contract, % complete (incl. override + `totalEstimatedCost===0` guard + cap at 100%),
  - earned revenue, over/under-billing (mutually exclusive, ≥0),
  - profit-to-date, cost-to-complete, backlog,
  - portfolio roll-up sums,
  - `flagWipRow` profit-fade / billing-swing / EVM-divergence classification with fixed inputs,
  - locked-period immutability (guard returns blocked).

---

## Out of scope (v1 / future)

- QuickBooks/Xero accounting sync (JACK integrates Xero; MAGE v1 exports PDF/CSV — integration is a later module).
- Multiple % -complete methods (v1 = cost-based with manual override; units-complete / milestone methods later).
- Bonding/surety report formats beyond standard WIP (P2).
