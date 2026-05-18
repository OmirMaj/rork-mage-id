# D1b-1 — GC-Authored Custom Assemblies — Design (v2, corrected model)

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` item **D1** ("author-your-own assemblies/rates"). D1a (estimate versioning) shipped. This spec is **D1b-1** only.

> **v2 correction (2026-05-18):** v1 of this spec keyed D1b-1 to `utils/estimateAssemblies.ts`'s `EstimateAssembly`. That was the wrong model — it has no live picker consumer. The estimator the GC actually uses (the Assemblies tab, AI quick-estimate, cost-breakdown, comparison) runs on **`AssemblyItem`** from `constants/assemblies.ts` (`ASSEMBLIES`). The prod `assemblies` table maps **1:1 to `AssemblyItem`** (not `EstimateAssembly`). v1's build was reverted (unmerged/unpushed). This v2 targets `AssemblyItem` — simpler, lossless, integrates into the *existing* picker with no parallel UI.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`. Code-only, **no migration**. OTA-able.

## 1. Decomposition (unchanged)

- **D1b-1 (THIS spec):** GC-authored custom assemblies, `AssemblyItem` model, persisted to the existing `assemblies` table, merged into the existing estimate Assemblies picker.
- **D1b-2 (separate follow-on, NOT here):** per-project cost-book / rate overrides — own brainstorm→spec→plan. Recorded in §7.

## 2. Problem

`constants/assemblies.ts` exposes a hardcoded `ASSEMBLIES: AssemblyItem[]` (the system presets) consumed by the estimate Assemblies tab (`app/(tabs)/estimate/index.tsx:457` `let results = ASSEMBLIES`), `AIQuickEstimate.tsx`, `CostBreakdownReport.tsx`, `EstimateComparison.tsx`. A GC cannot author/save their own recurring scopes. The `assemblies` table already exists in prod (RLS `assemblies_select_all` = `is_system=true OR auth.uid()=user_id`; `assemblies_insert_own`/`update_own`/`delete_own` with `is_system=false`+own), currently unused by the app. **No migration needed.**

Types (`constants/assemblies.ts`):
```ts
interface AssemblyMaterial { materialId: string; name: string; quantityPerUnit: number; unit: string; wasteFactor: number }
interface AssemblyLabor    { trade: string; hoursPerUnit: number }
interface AssemblyItem     { id: string; name: string; category: string; description: string; unit: string;
                             materialsPerUnit: AssemblyMaterial[]; laborPerUnit: AssemblyLabor[]; notes: string }
```

## 3. Goal / Non-goals

**Goal:** A GC can create/edit/delete their own `AssemblyItem`s; they appear in the **existing** Assemblies picker alongside the system `ASSEMBLIES`, badged "Custom", and flow through the **existing unchanged** `openAssemblyPopup`/`calculateAssemblyCost`/`handleAddAssembly`/`assemblyCart` path. Persisted to the existing `assemblies` table, user-scoped, offline-queue-safe.

**Non-goals (YAGNI / risk):** Touching `calculateAssemblyCost`/`openAssemblyPopup`/`handleAddAssembly`/the cart, or `ASSEMBLIES`; a parallel/second assembly section or popup; seeding system presets into the table; the `EstimateAssembly`/`utils/estimateAssemblies.ts` path (out of scope, separate legacy shape); per-project rate overrides (D1b-2); template-applied-assembly resolution of custom ids (`:595` `ASSEMBLIES.find` — leave as-is; the picker is the requirement); sharing/AI-authoring.

## 4. Architecture

### 4.1 Canonical shape = `AssemblyItem`

Custom assemblies ARE `AssemblyItem`s. The existing picker/cost/cart code consumes them with **zero change** (same type). No estimator logic is modified.

### 4.2 Table mapping (lossless, no migration)

`AssemblyItem` ⇄ `assemblies` row (near-1:1 — the table was designed for this model):
- `id`⇄`id`; `name`⇄`name`; `category`⇄`category`; `description`⇄`description` (`'' `↔`null`); `unit`⇄`unit`; `notes`⇄`notes` (`''`↔`null`)
- `materials` jsonb ← `materialsPerUnit: AssemblyMaterial[]`; `labor` jsonb ← `laborPerUnit: AssemblyLabor[]`
- `is_system`←`false`, `is_custom`←`true`, `user_id`←current user, `created_at`/`updated_at`←now
- Reconstruct: `AssemblyItem = { id, name, category, description: description ?? '', unit, materialsPerUnit: Array.isArray(materials)?materials:[], laborPerUnit: Array.isArray(labor)?labor:[], notes: notes ?? '' }`

Two pure helpers in a new `utils/assemblyRows.ts` (NOT in `constants/assemblies.ts` — keep the constant file data-only; and NOT in `utils/estimateAssemblies.ts` — that's the unrelated legacy shape): `assemblyItemToRow(a: AssemblyItem, userId: string): AssemblyRow` and `rowToAssemblyItem(row: AssemblyRow): AssemblyItem`. `AssemblyRow` type also defined there.

### 4.3 Data layer

`hooks/useCustomAssemblies.ts` — standalone offline-first hook mirroring `hooks/useTimeEntries.ts` exactly (NOT added to ProjectContext — H5 just split it). Surface:
- `customAssemblies: AssemblyItem[]` (the user's rows from `assemblies`, mapped via `rowToAssemblyItem`; defensively ignore `is_custom !== true`).
- `isLoading`, `addCustomAssembly(a)`, `updateCustomAssembly(a)`, `deleteCustomAssembly(id)` — optimistic local + AsyncStorage cache (`tertiary_custom_assemblies`, read via `safeJsonParse`) + `supabaseWrite('assemblies','insert'|'update'|'delete', assemblyItemToRow(a,userId) / {id})` through the offline queue (never a direct supabase write from UI). Same auth/cache/reconcile/unauthed semantics as `useTimeEntries.ts`.

### 4.4 Authoring UI (into the EXISTING picker — no parallel section)

`components/AssemblyEditorModal.tsx` — modal authoring an `AssemblyItem`: `name` (req), `category` (selector over `ASSEMBLY_CATEGORIES`), `description`, `unit` (text, e.g. "per LF"), repeatable `materialsPerUnit` rows (`name` req, `quantityPerUnit` ≥0, `unit`, `wasteFactor` ≥0; `materialId` may be `''`), repeatable `laborPerUnit` rows (`trade` req, `hoursPerUnit` ≥0), `notes`. Validation at the boundary (non-empty name; ≥1 material OR ≥1 labor row; finite non-negative numerics). Mirror an existing modal's pattern/styling. Builds an `AssemblyItem` (`id: initial?.id ?? generateUUID()`) → `onSave`.

Integration in `app/(tabs)/estimate/index.tsx` — **single source change**: at `filteredAssemblies` (`:456-457`), replace `let results = ASSEMBLIES;` with `let results = allAssemblies;` where `const allAssemblies = useMemo(() => [...ASSEMBLIES, ...customAssemblies.map(a => ({ ...a, __custom: true as const }))], [customAssemblies])`. The filter logic, `openAssemblyPopup`, `calculateAssemblyCost`, `handleAddAssembly`, `assemblyCart`, the FlatList/desktop map all stay **untouched** (custom items are real `AssemblyItem`s; the `__custom` extra is ignored by all of them). In `renderAssemblyCard` (`:1668`) add a "Custom" badge + Edit/Delete (custom only; system shows neither) and a "＋ New assembly" affordance in the assembly list header; wire to a single `<AssemblyEditorModal>` instance + the hook. Read the tag as `(item as AssemblyItem & { __custom?: boolean }).__custom === true` (do not widen `AssemblyItem`).

## 5. Error handling / correctness

Offline queue for all writes (H6b-hardened). Optimistic local; reconcile on load (server-wins on id, local-only survive — mirror `useTimeEntries`). Modal validation rejects malformed input inline. RLS + UI both restrict edit/delete to `is_custom` user rows. `rowToAssemblyItem` tolerant of short/legacy rows (missing arrays→`[]`, null text→`''`) — no crash in the picker. Cache read via `safeJsonParse` (H6c). `applyAssembly`/`EstimateAssembly`/`ESTIMATE_ASSEMBLIES` are NOT touched (unrelated path).

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual walkthrough:
- Create a custom assembly (materials + labor rows) → appears in the existing Assemblies picker, badged Custom, alongside system ones; filter/search/category still work.
- Tap it → the EXISTING assembly popup opens; `calculateAssemblyCost` computes correctly; add to `assemblyCart` works identically to a system assembly.
- Edit (change a material qty / add a labor row) → persists; re-add reflects it. Delete → removed; system unaffected.
- Airplane-mode create/edit → queued, survives, syncs. Reload → reloads from table identical (lossless).
- System assemblies + AI quick-estimate + cost-breakdown + comparison + the whole existing estimate flow behave EXACTLY as before (no regression; zero estimator-logic change).
- Final whole-impl review (opus).

## 7. Out of scope / future

- **D1b-2 — per-project cost-book / rate overrides** (other half of audit D1b): a per-project override store + precedence into estimate building. Separate spec/plan/build, queued after this.
- D1c (e-signable proposal) — next backlog item, separate.
- `EstimateAssembly`/`utils/estimateAssemblies.ts` consolidation, template-applied custom-assembly id resolution, assembly sharing/marketplace, AI-authored assemblies — not planned.
