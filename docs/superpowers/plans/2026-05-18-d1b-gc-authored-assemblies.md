# D1b-1 — GC-Authored Custom Assemblies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GC create/edit/delete their own estimate assemblies, persisted to the existing `assemblies` table, shown alongside the 42 system presets and applied via the unchanged `applyAssembly`.

**Architecture:** Canonical shape stays the app's `EstimateAssembly` (so `applyAssembly` is untouched). Lossless mapping helpers ⇄ the existing `assemblies` table. A standalone offline-first hook (`useCustomAssemblies`) mirroring `hooks/useTimeEntries.ts`. An assembly-editor modal. Merge custom into the estimate tab's existing `filteredAssemblies` data source.

**Tech Stack:** React Native/Expo, TypeScript strict, `utils/offlineQueue.ts` (`supabaseWrite`), AsyncStorage, existing estimate UI/components. No unit runner — gate = `npx tsc --noEmit` + manual walkthrough (spec §6).

**Spec:** `docs/superpowers/specs/2026-05-18-d1b-gc-authored-assemblies-design.md` (@ `81f5958`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

---

## CRITICAL

- **No migration** — the `assemblies` table + RLS already exist in prod. Build authors code only; no migration/deploy. Ships via OTA at controller ship-time.
- **No estimator change** — `applyAssembly` and `ESTIMATE_ASSEMBLIES` (the 42 system presets) must remain behaviorally untouched; custom assemblies are the same `EstimateAssembly` shape and flow through the SAME consumption path.
- **Offline-first** — every write goes through `supabaseWrite` (offline queue), never a direct `supabase.from(...)` from UI (CLAUDE.md). Mirror an existing hook.
- Per-task gate: `npx tsc --noEmit` clean + the named manual reasoning/check.

---

## File Structure

- Modify `utils/estimateAssemblies.ts` — Task 1: add `AssemblyRow` type + `assemblyToRow` / `rowToAssembly` pure helpers (co-located with `EstimateAssembly`).
- Create `hooks/useCustomAssemblies.ts` — Task 2: offline-first CRUD hook (mirror `hooks/useTimeEntries.ts`).
- Create `components/AssemblyEditorModal.tsx` — Task 3: the authoring modal.
- Modify `app/(tabs)/estimate/index.tsx` — Task 4: merge custom into `filteredAssemblies`, badge, +New/edit/delete wired to the modal + hook. (Also: find any OTHER consumer of `ESTIMATE_ASSEMBLIES`/`applyAssembly` — e.g. `app/estimate-wizard.tsx` — and feed it the merged set if it has its own picker.)

---

### Task 1: Mapping helpers + row type (pure, no I/O)

**Files:** Modify `utils/estimateAssemblies.ts`

- [ ] **Step 1: Add the row type + helpers**

After the existing `EstimateAssembly` interface in `utils/estimateAssemblies.ts`, add:
```ts
/** Shape of a row in the existing prod `assemblies` table (D1b-1 uses the
 *  table as a user-scoped store; columns map losslessly to EstimateAssembly). */
export interface AssemblyRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  unit: string;
  materials: { defaultAreaSf: number; items: EstimateAssemblyItem[] };
  labor: { items: EstimateAssemblyItem[] };
  notes: string | null;
  is_system: boolean;
  is_custom: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export function assemblyToRow(a: EstimateAssembly, userId: string): AssemblyRow {
  const now = new Date().toISOString();
  const laborItems = a.items.filter(i => i.category === 'labor');
  const nonLabor = a.items.filter(i => i.category !== 'labor');
  return {
    id: a.id,
    name: a.label,
    category: 'custom',
    description: a.description || null,
    unit: 'ea',
    materials: { defaultAreaSf: a.defaultAreaSf, items: nonLabor },
    labor: { items: laborItems },
    notes: null,
    is_system: false,
    is_custom: true,
    user_id: userId,
    created_at: now,
    updated_at: now,
  };
}

export function rowToAssembly(row: AssemblyRow): EstimateAssembly {
  const materials = row.materials ?? { defaultAreaSf: 100, items: [] };
  const labor = row.labor ?? { items: [] };
  return {
    id: row.id,
    label: row.name,
    description: row.description ?? '',
    defaultAreaSf: typeof materials.defaultAreaSf === 'number' && materials.defaultAreaSf > 0 ? materials.defaultAreaSf : 100,
    items: [...(Array.isArray(materials.items) ? materials.items : []), ...(Array.isArray(labor.items) ? labor.items : [])],
  };
}
```

- [ ] **Step 2: Gate** — `npx tsc --noEmit` from worktree root → clean. Reason: `rowToAssembly(assemblyToRow(a, 'u'))` deep-equals `a` for any valid `EstimateAssembly` (id/label/description/defaultAreaSf preserved; items order = nonLabor then labor — semantically irrelevant to `applyAssembly`, which scales each item independently). Defensive on a short/legacy row (missing `materials`/`labor` → fallbacks, no throw).

- [ ] **Step 3: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add utils/estimateAssemblies.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-1): EstimateAssembly <-> assemblies-table mapping helpers"
```

---

### Task 2: `useCustomAssemblies` offline-first hook

**Files:** Create `hooks/useCustomAssemblies.ts`

- [ ] **Step 1: Read the pattern to mirror**

Read `hooks/useTimeEntries.ts` (and skim `hooks/useSubSubmittedInvoices.ts`) — the established offline-first collection-hook pattern in this repo: AsyncStorage cache load → hydrate state → fetch from Supabase on auth → reconcile → CRUD that optimistically updates local state + `supabaseWrite(table, op, data)` through the offline queue. **Mirror that structure exactly** (same cache-then-network shape, same offline-queue usage, same auth-gating, same error-tolerance) — do not invent a new pattern.

- [ ] **Step 2: Implement the hook**

Create `hooks/useCustomAssemblies.ts` exporting `useCustomAssemblies()` returning:
```ts
{
  customAssemblies: EstimateAssembly[];   // user's rows, mapped via rowToAssembly
  isLoading: boolean;
  addCustomAssembly: (a: EstimateAssembly) => Promise<void>;     // generateUUID() id if absent
  updateCustomAssembly: (a: EstimateAssembly) => Promise<void>;
  deleteCustomAssembly: (id: string) => Promise<void>;
}
```
Specifics:
- AsyncStorage cache key: `tertiary_custom_assemblies` (follows the `tertiary_*` convention in CLAUDE.md for newer project sub-collections).
- Load: hydrate from cache, then (if authed) `supabase.from('assemblies').select('*')` — RLS returns only the user's own non-system rows (system presets are NOT in the table; they stay the `ESTIMATE_ASSEMBLIES` constant). Map rows via `rowToAssembly`; ignore any row where `is_custom !== true` defensively. Persist mapped list to cache. Tolerate fetch failure (keep cache; no crash) — mirror `useTimeEntries.ts`'s error handling.
- `add/update`: optimistic local state update + cache write, then `supabaseWrite('assemblies', 'insert'|'update', assemblyToRow(a, userId))`. (`update` passes the full row incl. `id`; the offline queue's update path does `update(rest).eq('id', id)`.)
- `delete`: optimistic remove + cache write, then `supabaseWrite('assemblies', 'delete', { id })`.
- Get `userId` the same way `useTimeEntries.ts` does (the repo's auth/session accessor — reuse it, do not add a new auth path). If no `userId`, the hook still serves cache and no-ops writes (mirror the existing hooks' unauthed behavior).
- Do NOT add this to `ProjectContext` (H5 just split it — keep this a standalone hook; spec §4.3).

- [ ] **Step 3: Gate** — `npx tsc --noEmit` clean. Reason through: cache-first render; authed fetch reconciles; CRUD optimistic + queued; unauthed serves cache + no-op writes; a malformed cached blob is tolerated (use `safeJsonParse` from `utils/safeJson.ts` for the AsyncStorage read — H6c helper).

- [ ] **Step 4: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add hooks/useCustomAssemblies.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-1): useCustomAssemblies offline-first CRUD hook"
```

---

### Task 3: Assembly-editor modal

**Files:** Create `components/AssemblyEditorModal.tsx`

- [ ] **Step 1: Inspect existing modal + estimate styling to reuse**

Read `app/(tabs)/estimate/index.tsx` around the existing assembly popup (`openAssemblyPopup`, `renderAssemblyCard`, `dStyles.catalogItem`, `styles.addButton`) and one existing editor-modal component in `components/` to match the repo's modal-in-screen pattern, styling tokens, and `lucide-react-native` icon usage. Reuse existing styles/components — no new design system.

- [ ] **Step 2: Implement the modal**

Create `components/AssemblyEditorModal.tsx`:
```tsx
export interface AssemblyEditorModalProps {
  visible: boolean;
  initial?: EstimateAssembly | null;   // null/undefined = create; set = edit
  onClose: () => void;
  onSave: (a: EstimateAssembly) => void; // parent calls add/updateCustomAssembly
}
```
- Fields: `label` (TextInput, required), `description` (TextInput, optional), `defaultAreaSf` (numeric TextInput, default 100, must be > 0).
- Repeatable item rows — each `EstimateAssemblyItem`: `name` (TextInput, required), `category` (selector over `'materials'|'labor'|'equipment'|'subcontractor'|'other'`), `unit` (selector over `'lf'|'sf'|'ea'|'hr'|'cy'|'ton'`), `qtyPer100Sf` (numeric, ≥ 0), `unitCost` (numeric, ≥ 0). "＋ Add item" appends a blank row; each row has a remove (✕). At least 1 item required.
- On Save: validate (non-empty label; ≥1 item; each item non-empty name; numerics parse and `defaultAreaSf > 0`, `qtyPer100Sf >= 0`, `unitCost >= 0`). If invalid → inline error, do not call `onSave`. If valid → construct an `EstimateAssembly` (`id`: `initial?.id ?? generateUUID()` from `@/utils/generateId`) and call `onSave(a)` then `onClose()`.
- Pre-fill all fields from `initial` when editing. Follow the back-button/modal-close pattern of the existing estimate modals.

- [ ] **Step 3: Gate** — `npx tsc --noEmit` clean. Reason: create + edit paths produce a valid `EstimateAssembly`; invalid input blocked with a message; numeric coercion safe (no `NaN` persisted).

- [ ] **Step 4: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add components/AssemblyEditorModal.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-1): assembly-editor modal"
```

---

### Task 4: Wire custom assemblies into the estimate Assemblies tab (+ other pickers)

**Files:** Modify `app/(tabs)/estimate/index.tsx` (+ `app/estimate-wizard.tsx` if it has its own assembly picker)

- [ ] **Step 1: Locate the data source + consumers**

In `app/(tabs)/estimate/index.tsx` find how `filteredAssemblies` is derived (it feeds both the mobile `<FlatList data={filteredAssemblies} renderItem={renderAssemblyCard}>` and the desktop `filteredAssemblies.map(... openAssemblyPopup)`), and where the base assembly list comes from (the `ESTIMATE_ASSEMBLIES` import / a derived `assemblies` array). Also grep the repo for every consumer of `ESTIMATE_ASSEMBLIES`/`applyAssembly` (`grep -rn "ESTIMATE_ASSEMBLIES\|applyAssembly" app/ components/`) — confirm whether `app/estimate-wizard.tsx` has its own picker that also needs the merged set, or only references the shape in a comment.

- [ ] **Step 2: Merge custom into the base list**

Call `const { customAssemblies, addCustomAssembly, updateCustomAssembly, deleteCustomAssembly } = useCustomAssemblies();` in the estimate screen. Build the base list as `const allAssemblies = useMemo(() => [...ESTIMATE_ASSEMBLIES, ...customAssemblies], [customAssemblies]);` and feed `allAssemblies` into wherever the existing `filteredAssemblies` filter/search operates (replace the `ESTIMATE_ASSEMBLIES` source with `allAssemblies` at that derivation point only — do not change the filter logic). System ones keep working identically; `applyAssembly`/`openAssemblyPopup` consume custom ones unchanged (same `EstimateAssembly` shape).

- [ ] **Step 3: Badge + author affordances**

In `renderAssemblyCard` (and the desktop row), if the assembly is custom (track via membership in `customAssemblies` by id, or a derived `isCustom` flag in the merged list — prefer a small `{ ...a, __custom: true }` tag added only in the merge for custom entries, read in render), show a "Custom" badge and edit + delete controls (delete → confirm → `deleteCustomAssembly(id)`; edit → open `AssemblyEditorModal` with `initial`). Add a "＋ New assembly" button in the Assemblies tab header/area that opens `AssemblyEditorModal` with no `initial`. Wire `onSave` → `initial ? updateCustomAssembly : addCustomAssembly`. System assemblies show NO edit/delete. Reuse existing badge/button styles.

- [ ] **Step 4: Propagate to other pickers (only if found in Step 1)**

If `app/estimate-wizard.tsx` (or any other file) renders its own assembly picker off `ESTIMATE_ASSEMBLIES`, apply the SAME minimal merge there (`[...ESTIMATE_ASSEMBLIES, ...customAssemblies]` via `useCustomAssemblies`) so custom assemblies are pickable everywhere. If it only references the shape in a comment (no picker), no change. Document which consumers were updated.

- [ ] **Step 5: Gate** — `npx tsc --noEmit` clean. Manual reasoning (and `bun run start` if feasible): system assemblies unchanged; a created custom assembly appears badged in the tab + any wizard picker, applies correctly to an estimate (totals recompute as for a system assembly), edits/deletes persist and reflect; offline create survives + syncs. No regression to the existing estimate/assembly flow.

- [ ] **Step 6: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add "app/(tabs)/estimate/index.tsx" app/estimate-wizard.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-1): GC custom assemblies in estimate picker (author/edit/delete)"
```

---

## Ship (controller, after final whole-impl review — not build)

Code-only, OTA-able, no migration. After final review APPROVES: FF-merge `claude/p0-launch-on-main` → `main`, push, `eas update --branch production --message "D1b-1 GC-authored custom assemblies"`. (Independent of H4's Netlify block.)

---

## Self-Review

**Spec coverage:** §4.1 canonical shape → Task 1 (helpers, applyAssembly untouched). §4.2 lossless mapping → Task 1 (`assemblyToRow`/`rowToAssembly` + round-trip reasoning). §4.3 data layer → Task 2 (standalone offline-first hook, not in ProjectContext). §4.4 authoring UI → Task 3 (modal) + Task 4 (merge/badge/affordances, modal-in-screen). §5 error handling → Task 1 defensive `rowToAssembly`, Task 2 `safeJsonParse` cache + offline queue + unauthed tolerance, Task 3 validation, RLS+UI defense-in-depth. §6 verification → each task gate + Task 4 manual. §1/§7 decomposition: D1b-2 explicitly NOT in any task. No gaps.

**Placeholder scan:** All new code (helpers, hook API, modal props/fields/validation, merge expression) is concrete. "Mirror `hooks/useTimeEntries.ts`" / "reuse existing estimate styles" / "find the `filteredAssemblies` derivation" are precise in-situ-adaptive directives against named anchors (the repo's established offline-hook pattern; the real data source) — not vague TODOs; reproducing useTimeEntries.ts or the estimate screen in the plan would be counterproductive. No "handle appropriately".

**Type/name consistency:** `EstimateAssembly`/`EstimateAssemblyItem` (existing), `AssemblyRow`/`assemblyToRow`/`rowToAssembly` (Task 1) used identically in Tasks 2/4. Hook name `useCustomAssemblies` + its API (`customAssemblies`,`addCustomAssembly`,`updateCustomAssembly`,`deleteCustomAssembly`,`isLoading`) consistent across Tasks 2 & 4. `AssemblyEditorModal` props (`visible`,`initial`,`onClose`,`onSave`) consistent Tasks 3 & 4. Category/unit literal unions match `EstimateAssemblyItem` exactly. Cache key `tertiary_custom_assemblies` single definition (Task 2).
