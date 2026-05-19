# S1.3 — Accounting CSV Export (QuickBooks Online / Xero) — Design

Sub-project **1 of 5** from the 2026-05-19 architecture/UX overhaul brief (decomposed; user-confirmed scope = all 5 real items, S2.2 dropped; cost-codes re-scoped additive-safe). This is the safest, no-dependency, highest-leverage item: it kills manual double-entry without touching schema or shipped behavior.

Build target: p0-on-main worktree (`/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`), branch `claude/p0-launch-on-main` == `main` @ `41bb68e`. **App-only, OTA-able. No migration, no edge-fn, no portal, no `types/index.ts` change, no new dependency** → Netlify-independent.

## 1. Reality-check correction (vs the pasted brief)

The brief said "code a client-side utility at `app/integrations/quickbooks-export.ts`." Verified reality: `app/integrations.tsx` is a **PREVIEW mock screen** (`MOCK_INTEGRATIONS`, no OAuth, no sync — deliberately) and is the wrong home for a real export. The real, accurate design: a pure `utils/` CSV builder + a trigger action inside the project-detail **Financials/invoices** sub-panel (where `projectInvoices` is already in scope), mirroring the existing **`utils/tax1099Export.ts`** pattern (build CSV string → write file → `Sharing.shareAsync`). This is consistent with how the app already does financial CSV/file exports (`utils/dataExport.ts`, `utils/tax1099Export.ts`, `utils/scheduleOps.ts`).

## 2. Problem

The audit + brief: the accounting screen is a static waitlist stub, forcing GCs into manual double-entry of invoices/payments into QuickBooks/Xero. The app already holds the authoritative data (`Invoice` model: number, dates, lineItems, subtotal, tax, totalDue, amountPaid, payments[], retention; AIA G702 totals via `computeAIATotals`; `projectFinancials.ts` accessors). It just can't get it *out* in a form an accountant's tool ingests.

## 3. Goal / Non-goals

**Goal:** From the project-detail Financials/invoices sub-panel, a GC exports that project's billed invoices (with line items, tax, payments) as a **QuickBooks Online**-compatible *or* **Xero**-compatible CSV (their import schemas differ materially, so two formatters), shareable via the OS share sheet. Read-only over already-loaded data; zero schema/behavior change to anything shipped.

**Non-goals (YAGNI / scope / honesty):**
- NOT live OAuth/2-way sync (that's the deliberately-deferred deep integration; out of scope, unchanged).
- NO change to `app/integrations.tsx` / `MOCK_INTEGRATIONS` (it stays the honest preview screen).
- NO `types/index.ts`, schema, migration, or edge-fn change. No new dependency (reuse `expo-file-system` + `expo-sharing` already used by `tax1099Export.ts`).
- NOT a generic "all projects / all data" dump (`utils/dataExport.ts` already exists for that) — this is the accountant-ingestible **invoice** export for one project.
- No bill/expense/PO export (invoices + their payments + AIA cover only — that is what "kills double-entry" for a GC's A/R).

## 4. Architecture

### 4.1 `utils/accountingExport.ts` (new, pure)
```ts
export type AccountingFormat = 'quickbooks' | 'xero';
export function buildAccountingCsv(
  format: AccountingFormat,
  project: Project,
  invoices: Invoice[],
): { filename: string; csv: string; rowCount: number };
export async function exportAccountingCsv(
  format: AccountingFormat, project: Project, invoices: Invoice[],
): Promise<{ ok: true; rowCount: number } | { ok: false; reason: string }>;
```
- **Row model:** both QBO and Xero import sales invoices as **one row per invoice line item**, repeating invoice-header fields per row (their real documented import shape). Only invoices with `status` in a billable set (exclude `draft`/`void`) are exported; each `invoice.lineItems[]` → one row; a trailing tax row per invoice when `taxAmount > 0`.
- **QuickBooks Online** columns (canonical QBO invoice-import header): `InvoiceNo, Customer, InvoiceDate, DueDate, Item(Product/Service), ItemDescription, ItemQuantity, ItemRate, ItemAmount, Taxable, TaxRate, ServiceDate, Memo`.
- **Xero** columns (canonical Xero sales-invoice import header): `ContactName, InvoiceNumber, InvoiceDate, DueDate, Description, Quantity, UnitAmount, AccountCode, TaxType, TrackingName1, TrackingOption1`. `AccountCode` left blank (the accountant maps on import — documented in the spec note and an in-app hint); `TrackingOption1` = project name (lets the accountant class by job).
- Customer/ContactName = `project.clientName ?? project.name`; dates ISO→`MM/DD/YYYY` (QBO) / `DD/MM/YYYY` (Xero) per each tool's default import locale expectation; money = 2dp, no currency symbol/thousands; **RFC-4180 CSV escaping** (quote fields containing `, " \n`, double embedded quotes) — reuse the escaping approach already in `utils/tax1099Export.ts` (confirm its exact helper at plan time and reuse, do not duplicate).
- `exportAccountingCsv` writes `FileSystem.documentDirectory + filename` then `Sharing.shareAsync` — exact same call shape as `tax1099Export.ts` (confirm + mirror at plan time). Filename: `<projectName>-invoices-<format>-<YYYYMMDD>.csv` (sanitized).
- Pure/total: empty/`null` invoices → `{ ok:false, reason:'No billable invoices to export' }` (no throw, no file).

### 4.2 UI trigger (project-detail Financials/invoices sub-panel)
In `app/project-detail.tsx`, within the existing invoices sub-section (where `projectInvoices` + `project` are already in scope), add one action: "Export to accounting (CSV)" → a 2-option chooser (QuickBooks Online / Xero) → `await exportAccountingCsv(fmt, project, projectInvoices)` → success/empty toast via the screen's existing toast (`nailIt`-style) pattern. Reuse an existing in-panel action-button style in the file (no new design system). Disabled/hidden when `projectInvoices` has no billable invoices.

### 4.3 Tier gating (deliberate, codebase-consistent)
Accounting is positioned as a **Business**-tier capability (`quickbooks_sync` FeatureKey, per the audit + `useTierAccess`/`FEATURE_LIMITS`). The export gates behind the existing Business accounting FeatureKey via `useTierAccess` (exact key confirmed at plan time) — non-entitled users see the standard upgrade affordance, not the export. Rationale: shipping CSV export *free* would undercut the tier model the audit flagged; gating it *consistently* is the honest product-aligned choice. (Surfaced as a deliberate decision, not an accident.)

## 5. Error handling / correctness

- Pure builder is total: no invoices / all-draft → `ok:false` friendly reason, no file written, never throws.
- Number formatting fixed 2dp; dates guarded (invalid date → empty cell, never `Invalid Date`).
- CSV injection hygiene: prefix a `'` to any cell beginning with `= + - @` (formula-injection guard) in addition to RFC-4180 quoting — accountant tools open these in Excel/Sheets.
- Read-only: no writes, no context mutation, no schema. The export reads the already-loaded `projectInvoices`/`project`; nothing shipped changes. `app/integrations.tsx`, `tax1099Export.ts`, `dataExport.ts` untouched.
- `npx tsc --noEmit` clean, strict, no `any` (per the brief's coding requirement).

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual reasoning:
- A project with ≥2 invoices (mixed full/progress, with line items, tax, a partial payment) → QBO CSV: header correct, one row per line item, tax row when taxAmount>0, money 2dp, dates MM/DD/YYYY, RFC-4180 quoting on a description containing a comma; Xero CSV: Xero header, DD/MM/YYYY, project name in TrackingOption1.
- Draft/void invoices excluded; 0 billable → friendly "nothing to export", no file.
- Formula-injection cell (`=cmd`) → prefixed with `'`.
- Non-Business tier → export gated (upgrade affordance), Business+ → works.
- Every other project-detail behavior, `integrations.tsx`, other exporters byte-unchanged; no schema/migration/dep.
- Final whole-impl review (opus).

## 7. Out of scope / future

Live OAuth QuickBooks/Xero 2-way sync; bill/expense/PO export; multi-project batch accounting export; IIF (desktop QuickBooks) format. The other 4 sub-projects (S2.1 hub tabs, S1.1 cost-codes additive-safe, S1.2 seal-document, S3 sub wizard) are their own specs in the confirmed build order.
