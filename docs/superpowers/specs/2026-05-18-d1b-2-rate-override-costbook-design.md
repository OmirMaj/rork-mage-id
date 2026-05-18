# D1b-2 — GC-Authored Rate-Override Cost-Book — Design

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` item **D1** ("author-your-own assemblies/**rates**"). The decomposed follow-on to D1b-1 (GC-authored assemblies, shipped) — D1b-1 spec §7 deferred this "rate/cost-book half" here.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`, HEAD `e56d20c`. **App + one small additive idempotent migration applied via Supabase MCP** (Netlify-independent, like D1c). OTA-able. No portal/edge-fn.

## 1. Scope decision (read first — the "per-project" reality)

The audit phrases this "per-project cost-book." Investigation: `app/(tabs)/estimate/index.tsx` is a **standalone estimator** — `calculateAssemblyCost(assembly, qty)` resolves material/labor costs at cart-add time, **before** a project is selected (a project is chosen later at link time via `buildLinkedEstimate` → `commitEstimatePatch`/`updateProject`). There is no project context at cost-compute time. True *per-project-at-compute* overrides would require re-architecting the cart→linkedEstimate pipeline to be project-scoped and re-costing on link — a large change with **high regression risk to the just-shipped D1b-1 + the estimator + `effectiveEstimateTotal`/D1a versioning**, disproportionate for a decomposed follow-on.

**Decision: D1b-2 ships a GC-level rate-override cost-book** (the GC's own labor-trade rates / material unit prices), which is exactly the audit's core grievance ("GC can't author their own rates"; D1b-1 covered assemblies) and slots into the **single** clean resolution hook (`calculateAssemblyCost`) with no estimator re-architecture. Per-project *layering* (a project overriding the GC book) is explicitly deferred (§7) — it requires the estimator to become project-scoped at compute time, out of proportion now. This is honest scoping: D1b-2 delivers the "author your own rates" value; "per-project" granularity is future.

## 2. Problem

`app/(tabs)/estimate/index.tsx` `calculateAssemblyCost`:
```
materialsCost: price = materials.find(m => m.id === mat.materialId)?.baseBulkPrice ?? 15
laborCost:     rate  = LABOR_RATES.find(r => r.trade === lab.trade)?.hourlyRate ?? 25
```
The GC cannot substitute their *own* labor rates (their real $/hr per trade) or material prices — costs come only from the system materials catalog + the `LABOR_RATES` constant (with $15/$25 fallbacks). D1b-1 let the GC author assemblies; D1b-2 lets them author the **rates** those assemblies cost out at. No existing rate-override store exists (`labor_rates`/`material_prices` are system reference data).

## 3. Goal / Non-goals

**Goal:** A GC can create/edit/delete their own rate overrides — per labor **trade** ($/hr) and/or per material (**materialId** unit price) — persisted offline-first, and `calculateAssemblyCost` resolves cost with precedence **GC override → existing system default → existing hardcoded fallback**. Surfaced via a cost-book editor (modal-in-screen). System assemblies, D1b-1 custom assemblies, the estimator, `effectiveEstimateTotal`/D1a are byte-unaffected when no override exists.

**Non-goals (YAGNI / risk / independence):**
- NOT per-project-at-compute overrides / estimator re-architecture (§1; deferred §7).
- No change to `LABOR_RATES`/the materials catalog/the system reference tables, `buildLinkedEstimate`, `commitEstimatePatch`, `effectiveEstimateTotal`, D1a versioning, or D1b-1.
- No change to the labor/material **cart** popups' manual rate entry (the existing per-add manual `adjustedRate` is untouched — the cost-book is the *default* source, not a replacement for ad-hoc edits).
- No portal/edge-fn; no `marketing/` (Netlify-independent).
- No AI rate suggestions, no regional indexing — just the GC's explicit overrides.

## 4. Architecture

Mirror D1b-1's proven shape: a small additive table + an offline-first hook + an editor modal + a single resolution-point merge.

### 4.1 Storage — small additive idempotent table (MCP-applied, Netlify-independent)

New migration `supabase/migrations/<ts>_rate_overrides.sql` (applied via Supabase MCP `apply_migration`, like D1c — independent of Netlify/H4):
```sql
create table if not exists public.rate_overrides (
  id uuid primary key,
  user_id uuid not null,
  kind text not null,            -- 'labor' | 'material'
  override_key text not null,    -- labor: trade name; material: materialId
  value numeric not null,        -- labor: $/hr; material: unit price
  label text,                    -- display label (trade / material name)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.rate_overrides enable row level security;
drop policy if exists rate_overrides_owner_all on public.rate_overrides;
create policy rate_overrides_owner_all on public.rate_overrides
  as permissive for all to public
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
Idempotent (`create table if not exists`, `drop policy if exists`/`create`), additive, own-rows RLS (mirrors the `assemblies`/`workers_*` own-RLS pattern verified in the H4 baseline). Confirm the canonical own-RLS form against a sample live policy at plan time (read-only) before finalizing the policy text.

### 4.2 Data layer — `hooks/useRateOverrides.ts` (mirror `hooks/useCustomAssemblies.ts` exactly)

Same offline-first pattern as D1b-1's `useCustomAssemblies` (which itself mirrors `useTimeEntries`): `useAuth`, AsyncStorage cache (`tertiary_rate_overrides`, read via `safeJsonParse`), authed `supabase.from('rate_overrides').select('*')` → mapped, `lastUserIdRef` user-isolation guard, single-writer persist, fetch-error tolerance, CRUD via `supabaseWrite('rate_overrides','insert'|'update'|'delete', row)` (offline queue; never a direct UI write). Surface:
```ts
{ overrides: RateOverride[]; isLoading;
  laborRate(trade: string): number | undefined;     // GC override $/hr for a trade, else undefined
  materialPrice(materialId: string): number | undefined;
  addOverride(o); updateOverride(o); deleteOverride(id); }
```
`RateOverride` type (a new `utils/rateOverrides.ts` with `rateOverrideToRow`/`rowToRateOverride` mapping helpers, mirroring `utils/assemblyRows.ts`). `laborRate`/`materialPrice` are O(1) lookups over the in-memory map. NOT added to ProjectContext (standalone hook, like `useCustomAssemblies`).

### 4.3 The single merge point — `calculateAssemblyCost`

In `app/(tabs)/estimate/index.tsx`, call `useRateOverrides()` and change ONLY the two resolution lines inside `calculateAssemblyCost` (add `laborRate`/`materialPrice` to its `useCallback` deps):
```ts
const price = materialPrice(mat.materialId) ?? (materials.find(m => m.id === mat.materialId)?.baseBulkPrice ?? 15);
const rate  = laborRate(lab.trade) ?? (LABOR_RATES.find(r => r.trade === lab.trade)?.hourlyRate ?? 25);
```
Precedence is exactly GC-override → existing system default → existing fallback. When the GC has NO override for that key, the expression is byte-equivalent to today (zero behavior change for the no-override path — D1b-1/system assemblies/totals unaffected). No other estimator code changes.

### 4.4 UI — cost-book editor (mirror D1b-1's AssemblyEditorModal pattern)

A `components/RateOverrideModal.tsx` (mirror `components/AssemblyEditorModal.tsx`'s modal-in-screen pattern/styling): list current overrides (labor: trade · $/hr; material: name · $); add/edit a labor override (trade selector from `LABOR_CATEGORIES`/`LABOR_RATES` + $/hr) or a material override (pick from the in-scope `materials` catalog + unit price); delete. Entry point: a "Cost book / My rates" affordance in the estimate screen's Labor and/or Assemblies area (reuse existing button styles, same way D1b-1 added "＋ New assembly"). Wire to the hook's CRUD. No new design system.

## 5. Error handling / correctness

- All writes via the offline queue (H6b-hardened); optimistic local; reconcile on load; user-isolation guard (mirror `useCustomAssemblies` — proven). Cache via `safeJsonParse` (H6c).
- `laborRate`/`materialPrice` return `undefined` when no override → the `??` chain falls through to the EXISTING resolution, so the no-override path is provably byte-identical to current behavior (no regression to D1b-1/system assemblies/estimator/`effectiveEstimateTotal`).
- Validation at the modal boundary: non-empty key/trade, finite `value > 0`. RLS + UI both scope overrides to the GC's own rows.
- Migration additive/idempotent (`create table if not exists` + `drop/create policy`) — safe, MCP-applied, reversible (drop table), Netlify-independent. App OTA is gated AFTER the migration (like D1c: migration-before-OTA, since `useRateOverrides` reads/writes the table).

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual:
- Add a labor override (e.g. Carpenter $95/hr) → an assembly using Carpenter costs at $95/hr (not the LABOR_RATES default); remove it → reverts to the default (byte-identical).
- Add a material override → that material in an assembly costs at the override; no override → unchanged.
- Offline add/edit → queued, survives, syncs (offline-queue path); reload → reloads from `rate_overrides` (lossless).
- System assemblies, D1b-1 custom assemblies, the labor/material cart popups, `buildLinkedEstimate`/link-to-project, `effectiveEstimateTotal`, D1a versioning — all byte-unaffected when no override exists (regression check).
- Migration `apply_migration` succeeds; re-run no-op; RLS own-rows enforced.
- Final whole-impl review (opus) — verify RLS/table claims against LIVE prod, not stale schema.sql.

## 7. Out of scope / future

- **Per-project rate-override layering** (a project overriding the GC cost-book) — requires the estimator to be project-scoped at compute time (cart→linkedEstimate pipeline rework); deferred, own spec when/if the estimator is refactored.
- Regional/CSI rate indexing, AI rate suggestions, bulk import of a rate sheet — future.
- D3-2 / D3-3 — separate.
