# D1b-1 — GC-Authored Custom Assemblies — Implementation Plan (v2, `AssemblyItem` model)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.
> **v2:** Corrected from the reverted v1 (which targeted the wrong `EstimateAssembly` shape). This targets `AssemblyItem` (`constants/assemblies.ts`) — the model the estimate picker actually uses; the DB `assemblies` table maps 1:1 to it; integration is a single source-array change into the existing picker (no parallel UI, no estimator-logic change).

**Goal:** GC creates/edits/deletes their own `AssemblyItem`s; they appear in the existing estimate Assemblies picker (badged Custom) and flow through the existing unchanged popup/cost/cart path. Persisted to the existing `assemblies` table.

**Tech Stack:** RN/Expo, TS strict, `utils/offlineQueue.ts` (`supabaseWrite`), AsyncStorage, `@/utils/safeJson`, existing estimate UI. No unit runner — gate = `npx tsc --noEmit` + manual (spec §6).

**Spec:** `docs/superpowers/specs/2026-05-18-d1b-gc-authored-assemblies-design.md` (v2). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

## CRITICAL
- **No migration** (table exists). Build authors code only; OTA at ship-time (controller).
- **Zero estimator change:** `ASSEMBLIES`, `openAssemblyPopup`, `calculateAssemblyCost`, `handleAddAssembly`, `assemblyCart`, the filter logic, the FlatList/desktop render — all UNTOUCHED. Custom items are real `AssemblyItem`s flowing the same path.
- **Do NOT touch** `utils/estimateAssemblies.ts` / `applyAssembly` / `ESTIMATE_ASSEMBLIES` (unrelated legacy shape).
- Offline-first: all writes via `supabaseWrite` (never direct supabase write from UI). Per-task gate: `npx tsc --noEmit` clean + named manual reasoning.

## File Structure
- Create `utils/assemblyRows.ts` — Task 1: `AssemblyRow` type + `assemblyItemToRow`/`rowToAssemblyItem` (pure).
- Create `hooks/useCustomAssemblies.ts` — Task 2: offline-first CRUD hook (mirror `hooks/useTimeEntries.ts`), `AssemblyItem[]`.
- Create `components/AssemblyEditorModal.tsx` — Task 3: author an `AssemblyItem`.
- Modify `app/(tabs)/estimate/index.tsx` — Task 4: single `filteredAssemblies` source merge + badge/edit/delete/＋New wired to modal+hook.

---

### Task 1: `utils/assemblyRows.ts` — mapping helpers (pure)

- [ ] **Step 1** Create `utils/assemblyRows.ts`:
```ts
import type { AssemblyItem, AssemblyMaterial, AssemblyLabor } from '@/constants/assemblies';

export interface AssemblyRow {
  id: string; name: string; category: string; description: string | null; unit: string;
  materials: AssemblyMaterial[]; labor: AssemblyLabor[]; notes: string | null;
  is_system: boolean; is_custom: boolean; user_id: string;
  created_at: string; updated_at: string;
}

export function assemblyItemToRow(a: AssemblyItem, userId: string): AssemblyRow {
  const now = new Date().toISOString();
  return {
    id: a.id, name: a.name, category: a.category,
    description: a.description || null, unit: a.unit,
    materials: a.materialsPerUnit, labor: a.laborPerUnit,
    notes: a.notes || null,
    is_system: false, is_custom: true, user_id: userId,
    created_at: now, updated_at: now,
  };
}

export function rowToAssemblyItem(row: AssemblyRow): AssemblyItem {
  return {
    id: row.id, name: row.name, category: row.category,
    description: row.description ?? '', unit: row.unit,
    materialsPerUnit: Array.isArray(row.materials) ? row.materials : [],
    laborPerUnit: Array.isArray(row.labor) ? row.labor : [],
    notes: row.notes ?? '',
  };
}
```
Confirm the real `AssemblyItem`/`AssemblyMaterial`/`AssemblyLabor` interfaces in `constants/assemblies.ts` match (id,name,category,description,unit,materialsPerUnit,laborPerUnit,notes); adapt the helper field-for-field if any name differs (report it). Do not modify `constants/assemblies.ts`.
- [ ] **Step 2** `npx tsc --noEmit` clean. Reason: `rowToAssemblyItem(assemblyItemToRow(a,'u'))` deep-equals `a` for any valid `AssemblyItem` (text fields identity; `''`↔`null`↔`''` round-trips; arrays passed through; short/legacy row → `[]`/`''` fallbacks, no throw).
- [ ] **Step 3** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add utils/assemblyRows.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-1): AssemblyItem <-> assemblies-table mapping helpers"
```

---

### Task 2: `hooks/useCustomAssemblies.ts` — offline-first hook

- [ ] **Step 1** Read `hooks/useTimeEntries.ts` fully (skim `hooks/useSubSubmittedInvoices.ts`). Mirror its offline-first structure EXACTLY: `useAuth()` accessor, AsyncStorage cache hydrate (via `safeJsonParse` from `@/utils/safeJson`, fallback `[]`) → authed Supabase fetch → `Map`-merge reconcile (server wins on id; local-only rows survive) → single-writer persist effect → `lastUserIdRef` user-isolation guard (clear state+cache on userId change) → fetch-error tolerance (keep cache, no throw) → CRUD optimistic + `supabaseWrite`.
- [ ] **Step 2** Create `hooks/useCustomAssemblies.ts` exporting `useCustomAssemblies()` → `{ customAssemblies: AssemblyItem[]; isLoading: boolean; addCustomAssembly(a: AssemblyItem): Promise<void>; updateCustomAssembly(a: AssemblyItem): Promise<void>; deleteCustomAssembly(id: string): Promise<void> }`. Cache key `tertiary_custom_assemblies`. Load: `supabase.from('assemblies').select('*')`, keep rows with `is_custom === true`, map via `rowToAssemblyItem`. add: assign `generateUUID()` (from `@/utils/generateId`) if `!a.id`; optimistic state+cache; `supabaseWrite('assemblies','insert', assemblyItemToRow(a,userId) as unknown as Record<string,unknown>)`. update: same with `'update'` (row includes `id` → queue does `.update(rest).eq('id',id)`). delete: optimistic remove; `supabaseWrite('assemblies','delete',{ id })`. Unauthed: serve cache, local-only writes (mirror `useTimeEntries`). Not in ProjectContext.
- [ ] **Step 3** `npx tsc --noEmit` clean; reason through cache-first/reconcile/queue/unauthed/user-isolation parity with `useTimeEntries`.
- [ ] **Step 4** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add hooks/useCustomAssemblies.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-1): useCustomAssemblies offline-first CRUD hook (AssemblyItem)"
```

---

### Task 3: `components/AssemblyEditorModal.tsx` — author an `AssemblyItem`

- [ ] **Step 1** Read the repo modal-in-screen pattern (mirror `components/SubDailyUpdateModal.tsx` — bottom-sheet `Modal`, `useThemedStyles`/`useTheme`, `useSafeAreaInsets`, header chevron, ScrollView body, Cancel/Save footer) + estimate styling + `ASSEMBLY_CATEGORIES` from `constants/assemblies.ts`.
- [ ] **Step 2** Create `components/AssemblyEditorModal.tsx`:
```tsx
export interface AssemblyEditorModalProps {
  visible: boolean; initial?: AssemblyItem | null;
  onClose: () => void; onSave: (a: AssemblyItem) => void;
}
```
Fields: `name` (req), `category` (selector over `ASSEMBLY_CATEGORIES`), `description`, `unit` (TextInput, e.g. "per LF"), `notes`. Repeatable `materialsPerUnit` rows: `name` (req), `quantityPerUnit` (numeric ≥0), `unit` (text), `wasteFactor` (numeric ≥0); `materialId` defaults `''`. Repeatable `laborPerUnit` rows: `trade` (req), `hoursPerUnit` (numeric ≥0). "＋ Add material"/"＋ Add labor" append; each row removable. Validate: `name` non-empty; at least one material OR one labor row; every present row's required text non-empty; numerics `Number.isFinite` and ≥0 (store as strings, coerce with `Number()` at save). Seed from `initial` (deep-copy arrays — no parent mutation); reseed on `visible` false→true. Build `AssemblyItem { id: initial?.id ?? generateUUID(), name:trim, category, description:trim, unit:trim, materialsPerUnit, laborPerUnit, notes:trim }` → `onSave(a); onClose()`. Invalid → inline error, no `onSave`. No persistence logic (parent's job).
- [ ] **Step 3** `npx tsc --noEmit` clean; reason create/edit/reopen/NaN/deep-copy.
- [ ] **Step 4** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add components/AssemblyEditorModal.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-1): AssemblyItem editor modal"
```

---

### Task 4: Wire into the existing estimate Assemblies picker (single source change)

- [ ] **Step 1** In `app/(tabs)/estimate/index.tsx`: import `useCustomAssemblies` + `AssemblyEditorModal`. Call the hook. Add `const allAssemblies = useMemo(() => [...ASSEMBLIES, ...customAssemblies.map(a => ({ ...a, __custom: true as const }))], [customAssemblies]);`.
- [ ] **Step 2** At `filteredAssemblies` (`~:456-457`), change ONLY `let results = ASSEMBLIES;` → `let results = allAssemblies;`. Add `customAssemblies` (or `allAssemblies`) to that `useMemo`'s dep array. Do NOT change the filter/search/category logic, `openAssemblyPopup`, `calculateAssemblyCost`, `handleAddAssembly`, `assemblyCart`, the FlatList/desktop map, or `renderAssemblyCard`'s existing body — custom items are real `AssemblyItem`s and flow through all of it unchanged.
- [ ] **Step 3** In `renderAssemblyCard` (`~:1668`): read `const isCustom = (item as AssemblyItem & { __custom?: boolean }).__custom === true;`. If `isCustom`, render a small "Custom" badge (reuse an existing badge style) + Edit and Delete affordances (system items: neither). Delete → `Alert.alert` confirm (repo pattern) → `deleteCustomAssembly(item.id)`. Edit → open modal with the item (strip `__custom`). Add a "＋ New assembly" control in the assembly list header (`assemblyListHeader`/results header area, matching existing button style) → opens modal with `initial=null`. Local state: `editorVisible`,`editorInitial`. Render ONE `<AssemblyEditorModal visible={editorVisible} initial={editorInitial} onClose={()=>setEditorVisible(false)} onSave={(a)=>{ editorInitial ? updateCustomAssembly(a) : addCustomAssembly(a); setEditorVisible(false); }} />`. Tapping the card body still calls the existing `openAssemblyPopup` (use a guarded state so Edit/Delete taps don't also open the popup — wrap Edit/Delete in their own `TouchableOpacity` with `onPress` that does the action and nothing else; if RN propagation is a concern, gate `openAssemblyPopup` with a ref set on edit/delete press).
- [ ] **Step 4** `npx tsc --noEmit` clean. Manual reasoning (+ `bun run start` only if quick): system assemblies + filter/popup/cost/cart unchanged; custom assembly appears badged, opens the existing popup, costs/carts correctly; edit/delete persist; offline create survives; no estimator-logic change. NO parallel section/popup.
- [ ] **Step 5** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add "app/(tabs)/estimate/index.tsx"
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-1): GC custom assemblies in existing estimate picker (author/edit/delete)"
```

---

## Ship (controller, after final whole-impl review — not build)
Code-only, no migration. FF-merge → push → `eas update --branch production --message "D1b-1 GC-authored custom assemblies"`. (Independent of H4 Netlify block.)

## Self-Review
**Spec coverage:** §4.1 AssemblyItem canonical → all tasks. §4.2 mapping → Task 1. §4.3 hook → Task 2. §4.4 modal+single-source-merge → Tasks 3-4. §5 error handling → defensive `rowToAssemblyItem`, `safeJsonParse`, offline queue, validation, RLS+UI. §6 → gates. Decomposition (no D1b-2) honored.
**Placeholder scan:** All new code given in full; in-situ directives ("change only `let results = ASSEMBLIES`", "mirror useTimeEntries/SubDailyUpdateModal") are precise against named anchors, not vague TODOs.
**Type/name consistency:** `AssemblyItem`/`AssemblyMaterial`/`AssemblyLabor` (constants/assemblies.ts), `AssemblyRow`/`assemblyItemToRow`/`rowToAssemblyItem` (Task 1) used identically in Tasks 2/4. Hook API + modal props consistent Tasks 2-4. `__custom` tag read identically Task 4. Cache key single (`tertiary_custom_assemblies`). No `EstimateAssembly` anywhere.
