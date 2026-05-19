# S1.1 — CSI Division Picker for CO Line Items — Design (honest re-scope)

Sub-project **3 of 5** from the 2026-05-19 brief, **honestly re-scoped** after reality-check (user-confirmed). The brief's original "new `cost_codes` table + FK + `cost_code_id` UUID + EVM engine refactor" was rejected because the brief's premise was substantially false against the real codebase. See §1.

Build target: p0-on-main worktree (`/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`), branch `claude/p0-launch-on-main` (== `main` @ `5e60b32`). **App-only, OTA-able. No migration, no edge-fn, no portal, no new dependency** → Netlify-independent.

## 1. Reality-check correction (vs the pasted brief)

Three findings invalidated the brief's S1.1:

1. **The brief's FK target tables don't exist.** `estimate_items`, `change_order_line_items`, `budget_actuals` — none exist in prod (verified via Supabase `information_schema.tables`). Estimate line items are jsonb inside `projects.linkedEstimate`/`estimate_versions`; CO line items are a jsonb array on the `change_orders` row; "budget actuals" is computed by `utils/jobCostEngine.ts`, not persisted as a table.
2. **A CSI MasterFormat catalog already exists in code.** `utils/csiMasterFormat.ts` (150 lines) ships the full CSI MasterFormat 2020 division catalog: `CSI_DIVISIONS` (50 divisions with titles + scope examples), `CSI_DIVISION_BY_NUMBER` map, `csiDivisionLabel()`, `classifyToCSIDivision(text)` keyword auto-mapper, `groupByCSIDivision<T>()` generic. A new `cost_codes` table would duplicate this static reference data.
3. **`csiDivision?: string` is already on every relevant line-item type EXCEPT `ChangeOrderLineItem`** (types/index.ts:963 / :1499 / :1620 / :3096 / :3117 / :3137 / :3151 — assembly, selection-option, finish, door, window, plan-sheet, etc., all already have it). `jobCostEngine.ts:88` already prefers `csiDivision` over free-text fallback. The engine plumbing is in place.

**What's actually missing:** (a) `ChangeOrderLineItem` has no `csiDivision?` field, so `jobCostEngine.attributeCOToPhase()` (`:165`) falls back to `co.description?.trim()` instead of a proper code — soft string-matching on CO line items is real. (b) The catalog is never wired into any line-item UI (`grep -rln csiMasterFormat` returns only the util itself) — no picker exists; users can't populate `csiDivision` anywhere. The cost-code structure is shipped at the data layer but invisible to the user.

So the honest, value-creating v1 is one tiny additive optional type field + one reusable picker component + one wire-in. Not a new table, not a UUID, not an engine refactor.

## 2. Problem

A GC adding a change-order line item has no way to tag it with a CSI MasterFormat division — even though the catalog is right there in `utils/csiMasterFormat.ts`. The result: every CO line item has `csiDivision` absent (the field isn't even on the type), and `jobCostEngine` is forced to fall back to free-text matching on `co.description`. CO contributions to per-phase actuals are therefore best-effort at best.

## 3. Goal / Non-goals

**Goal:** Add an optional `csiDivision?: string` to `ChangeOrderLineItem`; build a reusable `CSIDivisionPicker` component (uses the existing `CSI_DIVISIONS` catalog with `classifyToCSIDivision` auto-suggest); wire it into the change-order line-item form so each CO line item *can* carry a CSI division. The field is purely additive optional — every existing CO and CO line item keeps working as today.

**Non-goals (YAGNI / scope / honesty):**
- NOT a new `cost_codes` table, NOT a new `costCodeId` UUID, NOT any schema/migration change. The brief's table/FK premise duplicates `CSI_DIVISIONS` + `csiDivision?: string`.
- NOT an `earnedValueEngine.ts` refactor (the engine doesn't group by phase/cost-code anyway — the audit's framing was inaccurate for EVM; EVM is project-level totals).
- NOT a `jobCostEngine.ts` refactor in this sub-project. Once CO line items can carry `csiDivision`, a later v2 can enrich `attributeCOToPhase()` to walk `co.lineItems` and aggregate by line; deferred (own follow-up).
- NOT wiring the picker into estimate-item edit / material edit / other line-item types. Estimate items typically inherit `csiDivision` from the material catalog already; manually overriding it is a softer, lower-leverage enhancement than enabling it on CO line items where the field is currently absent. Deferred.
- NO change to `utils/csiMasterFormat.ts` (reuse as-is), `app/integrations.tsx`, edge-fns, portal, RevenueCat/tiers. Ungated (data-quality UX, parity with how `csiDivision` is exposed elsewhere — i.e. not behind a tier).

## 4. Architecture

### 4.1 `types/index.ts` (additive optional field)
Add one line to `interface ChangeOrderLineItem` (~:978-987):
```ts
  csiDivision?: string;
```
Optional, no default, no migration (CO line items are jsonb inside `change_orders` rows; an absent field is the existing behavior).

### 4.2 `components/CSIDivisionPicker.tsx` (new)
Props:
```ts
export interface CSIDivisionPickerProps {
  value: string | undefined;                         // current 2-digit division code or undefined
  onChange: (next: string | undefined) => void;      // called with '03' or undefined (clear)
  /** Free-text description used to auto-suggest a division (e.g. the line-item description). */
  suggestFromText?: string;
  /** Optional test id for E2E hooks. */
  testID?: string;
}
```
UI: a small inline trigger (TouchableOpacity) showing `csiDivisionLabel(value)` if set (e.g. "03 — Concrete") else "Pick CSI division". Tap → a `Modal` containing:
- An optional "Suggested" pill at top when `suggestFromText` yields a `classifyToCSIDivision(suggestFromText)` non-null result and it's not already the current value — tap to apply.
- A search TextInput filtering `CSI_DIVISIONS` by case-insensitive substring of `number`/`title`/`examples`.
- A scrollable list of all 50 divisions (number + title + first 2-3 examples as muted hint).
- A "Clear" action when `value` is set.
- An "Cancel" / backdrop-close.
Selecting → `onChange(div.number)` + close. Clear → `onChange(undefined)` + close. Mirrors the file's existing modal/in-screen patterns; no new design system; uses existing `themeColors`, `Tokens`, `Type`. Strict TS, no `any`.

### 4.3 Wire into `app/change-order.tsx` line-item form
In each line-item edit row (where `lineItems` are mapped to JSX with the description `TextInput` etc.), add the `<CSIDivisionPicker value={item.csiDivision} suggestFromText={item.description} onChange={(next) => setLineItems(prev => prev.map(li => li.id === item.id ? { ...li, csiDivision: next } : li))} />` adjacent to the description field. The setter is the existing line-item-update path (already used at `:285,292`). No change to total math, validation, save logic, or any other handler.

## 5. Error handling / correctness

- Type field is optional — every existing CO line item / saved CO / serialized snapshot keeps working unchanged. Zero migration. Zero shipped-behavior change unless the user sets a value.
- `CSIDivisionPicker` is purely controlled (no internal state of `value`). Empty/whitespace `suggestFromText` → no "Suggested" pill (per `classifyToCSIDivision`'s null-on-short-text guard).
- Unknown legacy `csiDivision` strings (e.g. `'06 1000'` with a section suffix from other line-item types) are accepted as-is and rendered via `csiDivisionLabel`'s fallback path; picker selection always writes a 2-digit code from the catalog. (`csiDivisionLabel` returns the full title for known 2-digit codes; for unknown strings it returns the input — already its existing contract.)
- Strict TS, no `any`. `npx tsc --noEmit` clean.
- jobCostEngine continues to use `co.description` fallback as today (unchanged). A later v2 can prefer `lineItem.csiDivision` aggregation — explicitly deferred.

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual reasoning:
- A CO with line items: each row now exposes a "Pick CSI division" affordance; tap → modal opens; the suggestion pill appears when the line description matches a catalog keyword; selecting a division persists `csiDivision` on that line item; "Clear" unsets; save+reload restores the value (jsonb round-trip).
- Existing CO with line items lacking `csiDivision` renders identically to before (field absent ⇒ "Pick CSI division" affordance with no preselected value); save without touching → byte-identical persisted CO.
- `jobCostEngine.attributeCOToPhase()` behavior byte-unchanged (still `co.description` fallback) — confirmed no engine touch.
- No other CO behavior, no other line-item type, no other screen affected.
- Final whole-impl review (opus).

## 7. Out of scope / future

- Picker wiring into estimate-item edit / material edit / selection-option edit / plan-sheet edit (estimate items inherit `csiDivision` from materials; lower-leverage enhancement). Own follow-up.
- `jobCostEngine.attributeCOToPhase()` enrichment to walk `co.lineItems` and aggregate by per-line `csiDivision` when present (the real downstream payoff of this sub-project). Own follow-up — small, additive engine prefer/fallback change once data starts flowing.
- A `cost_codes` table / GC-custom code library / per-project code override — only meaningful if and when a real GC asks for codes beyond CSI MasterFormat. Deferred indefinitely; the existing `CSI_DIVISIONS` is sufficient.
- Sub-projects S1.2 (seal-document) and S3 (sub wizard) remain — verified separately before each.
