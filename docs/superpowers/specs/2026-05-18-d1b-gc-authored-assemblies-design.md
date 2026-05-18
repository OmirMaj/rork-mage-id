# D1b-1 — GC-Authored Custom Assemblies — Design

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` item **D1** ("author-your-own assemblies/rates"). D1a (estimate versioning) already shipped. This spec is **D1b-1** only.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`, HEAD `a5fc2a1`. Code-only, **no migration** (the `assemblies` table already exists in prod with RLS). OTA-able.

## 1. Decomposition (D1b split — important)

D1b ("author-your-own assemblies *and* rates") is two separable concerns with different data models and risk profiles. Per the brainstorming decomposition guidance + the audit's "D1 phased":

- **D1b-1 (THIS spec): GC-authored custom assemblies.** DB-ready (the `assemblies` table + RLS already exist in prod, unused by the app today). Pure app-side: CRUD + merge into the estimate flow. Highest lock-in, lowest risk, self-contained, shippable now.
- **D1b-2 (SEPARATE follow-on spec, NOT built here): per-project cost-book / rate overrides.** Requires a new storage decision (no per-project override store exists — `labor_rates`/`material_prices` are system reference data) + merge/precedence into estimate building. Recorded in §7 as the next sub-project; its own brainstorm→spec→plan cycle.

## 2. Problem

`utils/estimateAssemblies.ts` exposes a hardcoded `ESTIMATE_ASSEMBLIES: EstimateAssembly[]` (the 42 system presets) and `applyAssembly(assembly, areaSf) → LinkedEstimateItem[]`. A GC cannot create/save their own assemblies (their real recurring scopes — "my standard bathroom gut", "my deck package"). The audit calls versioned, assembly-driven estimating the market's #1 loved depth; not being able to author your own is the gap.

The `assemblies` table already exists in prod: `id uuid, name text NOT NULL, category text NOT NULL, description text, unit text NOT NULL, materials jsonb NOT NULL, labor jsonb NOT NULL, notes text, is_system bool, is_custom bool, user_id uuid, created_at, updated_at`, with RLS `assemblies_select_all` (`is_system = true OR auth.uid() = user_id`), `assemblies_insert_own`/`assemblies_update_own`/`assemblies_delete_own` (`is_system = false` + own). The app currently reads/writes none of it. **No migration needed.**

## 3. Goal / Non-goals

**Goal:** A GC can create, edit, and delete their own assemblies; their custom assemblies appear alongside the 42 system assemblies everywhere assemblies are picked, and apply to an estimate via the existing unchanged `applyAssembly`. Persisted to the existing `assemblies` table, user-scoped, offline-queue-safe.

**Non-goals (YAGNI / risk):** Re-architecting the estimator's assembly model or `applyAssembly`; normalizing the table's `materials`/`labor` columns into a different assembly concept; seeding the 42 system assemblies into the table (they stay the TS constant — merged client-side); per-project rate overrides / cost-book (that is D1b-2); sharing/marketplace of assemblies; AI-generated assembly authoring.

## 4. Architecture

### 4.1 Canonical shape stays the app's `EstimateAssembly`

Keep `EstimateAssembly` / `EstimateAssemblyItem` (in `utils/estimateAssemblies.ts`) as the single canonical shape so `applyAssembly` works **unchanged** for both system and custom assemblies (uniform consumption — no estimator changes). The DB table's columns were designed for a more-normalized assembly concept the app never adopted; D1b-1 uses the table purely as a user-scoped persistence store, mapping the app shape onto its columns losslessly (a future normalization effort can revisit — out of scope).

### 4.2 Table mapping (lossless, no migration)

`EstimateAssembly { id, label, description, defaultAreaSf, items: EstimateAssemblyItem[] }` ⇄ `assemblies` row:
- `id` ⇄ `id` (uuid)
- `name` ← `label`
- `description` ← `description`
- `category` ← `'custom'` (constant; the app model has no assembly-level category — items carry category)
- `unit` ← `'ea'` (constant nominal; the app model's units are per-item)
- `materials` jsonb ← `{ defaultAreaSf, items: <items where category !== 'labor'> }`
- `labor` jsonb ← `{ items: <items where category === 'labor'> }`
- `notes` ← `null` (unused by D1b-1)
- `is_system` ← `false`, `is_custom` ← `true`, `user_id` ← current user id, `created_at`/`updated_at` ← now
- **Reconstruct on load:** `EstimateAssembly = { id, label: row.name, description: row.description ?? '', defaultAreaSf: row.materials.defaultAreaSf ?? <fallback 100>, items: [...row.materials.items, ...row.labor.items] }`. Item order within materials vs labor is not semantically significant to `applyAssembly` (it scales each item independently), so the split round-trips correctly.

Two pure helpers in `utils/estimateAssemblies.ts` (co-located with the shape they convert): `assemblyToRow(a: EstimateAssembly, userId: string): AssemblyRow` and `rowToAssembly(row: AssemblyRow): EstimateAssembly`. Unit-of-truth for the mapping; no logic elsewhere depends on the column layout.

### 4.3 Data layer

A focused hook/provider for the user's custom assemblies (follow the repo's offline-first convention — `supabaseWrite` via `utils/offlineQueue.ts`, optimistic local state, AsyncStorage cache key `tertiary_*`-style or reuse an existing context if one cleanly owns estimate-adjacent data). Surface:
- `customAssemblies: EstimateAssembly[]` (loaded from `assemblies` where the row is the user's — RLS returns only own non-system rows since system assemblies are not seeded in the table; map via `rowToAssembly`).
- `addCustomAssembly(a)`, `updateCustomAssembly(a)`, `deleteCustomAssembly(id)` — optimistic local update + `supabaseWrite('assemblies','insert'|'update'|'delete', assemblyToRow(...) / { id })` through the offline queue (never a direct supabase write from UI, per CLAUDE.md).
- A derived `allAssemblies = [...ESTIMATE_ASSEMBLIES, ...customAssemblies]` selector for pickers (system first, then the GC's, visually distinguished). Decide during planning whether this belongs in an existing estimate context vs a new small one — prefer the smallest cohesive home; do not bloat the just-split ProjectContext (H5).

### 4.4 Authoring UI (modal-in-screen, where assemblies are used)

The estimate flow already presents assemblies in `app/(tabs)/estimate/index.tsx` (an "Assemblies" tab + `assemblyCart`) and `app/estimate-wizard.tsx` (the picker consuming `ESTIMATE_ASSEMBLIES`). Per the repo's modal-in-screen pattern:
- In the Assemblies tab/picker, render system + custom assemblies in one list (custom badged, e.g. "Custom"). System ones are read-only; custom ones have edit/delete affordances.
- A "＋ New assembly" action opens an **assembly-editor modal**: fields `label`, `description`, `defaultAreaSf` (number), and a repeatable item editor — each item: `name`, `category` (materials/labor/equipment/subcontractor/other), `unit` (lf/sf/ea/hr/cy/ton), `qtyPer100Sf` (number), `unitCost` ($). Add/remove item rows. Save → `addCustomAssembly`; editing an existing custom assembly reuses the same modal pre-filled → `updateCustomAssembly`. Delete with a confirm.
- Picking a custom assembly applies it via the existing `applyAssembly` exactly like a system one (no consumption-path change). Reuse existing estimate styling/components; no new design system.

### 5. Error handling / correctness

- All writes go through the offline queue (consistent offline-first; H6b cap/flush already hardened). Optimistic local state; reconcile on load.
- Validation at the modal boundary: non-empty `label`; ≥1 item; numeric `defaultAreaSf > 0`, `qtyPer100Sf >= 0`, `unitCost >= 0`. Reject save otherwise (inline message) — never persist a malformed assembly.
- RLS already prevents editing system/other users' rows; the UI also only exposes edit/delete on `is_custom` user rows (defense in depth, and correct UX).
- `rowToAssembly` tolerates a legacy/short row (missing `defaultAreaSf` → fallback 100; missing `items` arrays → `[]`) so a partially-formed row never crashes the picker (use the H6c `safeJson`/defensive pattern where parsing jsonb client-side).

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + manual walkthrough:
- Create a custom assembly (multiple items, mixed categories) → it appears in the Assemblies tab AND the estimate-wizard picker, badged custom, below the system ones.
- Apply it to an estimate → correct `LinkedEstimateItem`s (same scaling as a system assembly), estimate totals recompute correctly.
- Edit it (change an item cost / add an item) → persists; re-applying reflects the change.
- Delete it → removed from pickers; system assemblies unaffected.
- Airplane-mode create/edit → queued, survives, syncs on reconnect (offline-queue path).
- Round-trip: reload app → custom assemblies reload from the table identical (lossless mapping).
- System assemblies + existing estimate flows behave exactly as before (no regression to `applyAssembly` or the 42 presets).
- Final whole-impl review (opus).

## 7. Out of scope / future

- **D1b-2 — per-project cost-book / rate overrides** (the other half of the audit's D1b): a per-project store (new `project_rate_overrides` table OR a `projects` jsonb field — decision deferred to its own brainstorm) letting a GC override labor/material rates per project, applied with precedence (project override → custom assembly value → system reference) when building estimates. Separate spec/plan/build; queued after this.
- D1c (one-tap e-signable proposal) — already the next backlog item, separate.
- Assembly sharing/marketplace, AI-authored assemblies, table normalization — not planned.
