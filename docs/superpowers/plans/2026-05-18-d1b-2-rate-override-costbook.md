# D1b-2 — GC-Authored Rate-Override Cost-Book — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A GC authors their own labor-trade $/hr + material unit-price overrides; `calculateAssemblyCost` resolves cost as **GC override → existing system default → existing fallback**, with zero behavior change when no override exists.

**Architecture:** Mirror the shipped D1b-1 pattern exactly: small additive idempotent table (MCP-applied, Netlify-independent like D1c) → mapping helpers (mirror `utils/assemblyRows.ts`) → offline-first hook (mirror `hooks/useCustomAssemblies.ts`) → editor modal (mirror `components/AssemblyEditorModal.tsx`) → a 2-line merge in `calculateAssemblyCost` + an entry point. GC-level scope (per-project layering deferred — spec §1/§7).

**Tech Stack:** RN/Expo, TS strict, Supabase (`rate_overrides` table), offline queue, AsyncStorage, `@/utils/safeJson`. No unit runner — gate = `npx tsc --noEmit` + manual (spec §6).

**Spec:** `docs/superpowers/specs/2026-05-18-d1b-2-rate-override-costbook-design.md` (@ `8db8b10`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

## CRITICAL
- **Build authors files only.** The migration is authored as `.sql`; **applying it via Supabase MCP `apply_migration` is a SHIP-TIME controller step**, sequenced **before** the OTA (like D1c — `useRateOverrides` reads/writes the table). Not a build step.
- **Zero-regression invariant:** when the GC has NO override for a key, `calculateAssemblyCost` must be byte-equivalent to today (the `??`-fallthrough). Do NOT change `LABOR_RATES`, the materials catalog, `buildLinkedEstimate`, `commitEstimatePatch`, `effectiveEstimateTotal`, D1a, D1b-1, or the labor/material cart popups.
- Per-task gate: `npx tsc --noEmit` clean + the named manual reasoning.

## File Structure
- Create `supabase/migrations/20260518160000_rate_overrides.sql` — T1.
- Create `utils/rateOverrides.ts` (`RateOverride`, `RateOverrideRow`, `rateOverrideToRow`, `rowToRateOverride`) — T2.
- Create `hooks/useRateOverrides.ts` — T3.
- Create `components/RateOverrideModal.tsx` — T4.
- Modify `app/(tabs)/estimate/index.tsx` (2-line merge in `calculateAssemblyCost` + cost-book entry + modal mount) — T5.

---

### Task 1: Additive `rate_overrides` migration (authored only)

**Files:** Create `supabase/migrations/20260518160000_rate_overrides.sql`

- [ ] **Step 1** Create exactly (own-RLS form copied verbatim from the verified committed baseline `commitments_owner_all`/`prequal_packets_owner_all`):
```sql
-- D1b-2 — GC-authored rate-override cost-book store. Additive, idempotent,
-- own-rows RLS (mirrors commitments_owner_all). Applied via Supabase MCP
-- apply_migration at ship (Netlify-independent), BEFORE the OTA.
create table if not exists public.rate_overrides (
  id uuid primary key,
  user_id uuid not null,
  kind text not null,
  override_key text not null,
  value numeric not null,
  label text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.rate_overrides enable row level security;
drop policy if exists rate_overrides_owner_all on public.rate_overrides;
create policy rate_overrides_owner_all on public.rate_overrides as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
```
- [ ] **Step 2** Static check: `create table if not exists` + `enable row level security` + `drop policy if exists`/`create policy` only; no other DDL; the policy text is byte-identical in shape to baseline line 228/628 (just the table/policy name differs). `npx tsc --noEmit` clean (SQL-only). **Do NOT apply.**
- [ ] **Step 3** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add supabase/migrations/20260518160000_rate_overrides.sql
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-2): additive rate_overrides table (own-RLS, idempotent)"
```

---

### Task 2: `utils/rateOverrides.ts` — type + mapping helpers (pure)

**Files:** Create `utils/rateOverrides.ts`

- [ ] **Step 1** Read `utils/assemblyRows.ts` (the D1b-1 mapping-helper pattern to mirror exactly). Create `utils/rateOverrides.ts`:
```ts
export interface RateOverride {
  id: string;
  kind: 'labor' | 'material';
  key: string;        // labor: trade name; material: materialId
  value: number;      // labor: $/hr; material: unit price
  label?: string;     // display (trade / material name)
}
export interface RateOverrideRow {
  id: string; user_id: string; kind: string; override_key: string;
  value: number; label: string | null; created_at: string; updated_at: string;
}
export function rateOverrideToRow(o: RateOverride, userId: string): RateOverrideRow {
  const now = new Date().toISOString();
  return { id: o.id, user_id: userId, kind: o.kind, override_key: o.key,
    value: o.value, label: o.label || null, created_at: now, updated_at: now };
}
export function rowToRateOverride(r: RateOverrideRow): RateOverride {
  return { id: r.id,
    kind: r.kind === 'material' ? 'material' : 'labor',
    key: r.override_key, value: Number(r.value),
    label: r.label ?? undefined };
}
```
(Defensive `rowToRateOverride`: unknown kind → `'labor'`; `Number(r.value)`; null label → undefined. Same robustness style as `rowToAssemblyItem`.)
- [ ] **Step 2** `npx tsc --noEmit` clean. Reason: `rowToRateOverride(rateOverrideToRow(o,'u'))` deep-equals `o` (id/kind/key/value/label round-trip; `''`label→null→undefined; Number() idempotent on a number); short/bad row → safe defaults, no throw.
- [ ] **Step 3** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add utils/rateOverrides.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-2): RateOverride <-> rate_overrides mapping helpers"
```

---

### Task 3: `hooks/useRateOverrides.ts` — offline-first hook (mirror `useCustomAssemblies`)

**Files:** Create `hooks/useRateOverrides.ts`

- [ ] **Step 1** Read `hooks/useCustomAssemblies.ts` FULLY (the shipped D1b-1 offline-first hook; itself mirrors `useTimeEntries`). Mirror its structure EXACTLY: `useAuth`, AsyncStorage cache hydrate via `safeJsonParse` (key `tertiary_rate_overrides`, fallback `[]`), authed `supabase.from('rate_overrides').select('*')` → `rowToRateOverride`, `lastUserIdRef` user-isolation guard, single-writer persist effect, fetch-error tolerance, CRUD optimistic + `supabaseWrite('rate_overrides','insert'|'update'|'delete', rateOverrideToRow(o,userId) as unknown as Record<string,unknown> / { id })`, unauthed = serve cache + local-only. NOT added to ProjectContext.
- [ ] **Step 2** Export `useRateOverrides()` →
```ts
{ overrides: RateOverride[]; isLoading: boolean;
  laborRate: (trade: string) => number | undefined;
  materialPrice: (materialId: string) => number | undefined;
  addOverride: (o: RateOverride) => Promise<void>;
  updateOverride: (o: RateOverride) => Promise<void>;
  deleteOverride: (id: string) => Promise<void>; }
```
`laborRate(trade)` = `overrides.find(o => o.kind==='labor' && o.key===trade)?.value` (undefined if none). `materialPrice(materialId)` = `overrides.find(o => o.kind==='material' && o.key===materialId)?.value`. (O(n) over a tiny list is fine; or memo a Map — match `useCustomAssemblies`'s simplicity.) `addOverride`: `generateUUID()` if `!o.id`. Import types/helpers from `@/utils/rateOverrides`; mirror `useCustomAssemblies`'s exact auth/cache/reconcile/persist/unauthed code.
- [ ] **Step 3** `npx tsc --noEmit` clean. Report parity vs `useCustomAssemblies` (auth, cache+safeJsonParse, reconcile-keeps-local-only, user-isolation guard, single-writer persist, unauthed, supabaseWrite shapes).
- [ ] **Step 4** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add hooks/useRateOverrides.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-2): useRateOverrides offline-first hook (mirror useCustomAssemblies)"
```

---

### Task 4: `components/RateOverrideModal.tsx` — cost-book editor (mirror `AssemblyEditorModal`)

**Files:** Create `components/RateOverrideModal.tsx`

- [ ] **Step 1** Read `components/AssemblyEditorModal.tsx` (the shipped D1b-1 modal-in-screen pattern/styling to mirror: bottom-sheet `Modal`, `useThemedStyles`/`useTheme`, `useSafeAreaInsets`, header chevron, ScrollView, footer, validation, deep-copy on edit, reseed on `visible`). `constants/laborRates.ts` exports `LaborRate { id, trade, category, hourlyRate }`, `LABOR_RATES`, `LABOR_CATEGORIES`.
- [ ] **Step 2** Create `components/RateOverrideModal.tsx`:
```tsx
export interface RateOverrideModalProps {
  visible: boolean;
  overrides: RateOverride[];
  materials: { id: string; name?: string; baseBulkPrice?: number }[]; // the estimate screen's in-scope catalog (pass the real type it uses)
  onClose: () => void;
  onAdd: (o: RateOverride) => void;
  onUpdate: (o: RateOverride) => void;
  onDelete: (id: string) => void;
}
```
Behavior (mirror AssemblyEditorModal's modal/validation/state-reseed conventions): list current `overrides` (labor: `${label||key} · $${value}/hr` with edit/delete; material: `${label||key} · $${value}` with edit/delete). "＋ Labor rate" → a sub-form: trade selector over `LABOR_RATES` (show each trade + its default `hourlyRate` for reference) + numeric `$/hr`; on save build `{ id: generateUUID(), kind:'labor', key:<trade>, value:<num>, label:<trade> }` → `onAdd`. "＋ Material price" → pick from `materials` (name) + numeric unit price → `{ kind:'material', key:<material.id>, value, label:<material.name> }` → `onAdd`. Edit reuses the sub-form pre-filled (deep-copied) → `onUpdate`. Delete → confirm (repo `Alert.alert` pattern) → `onDelete(id)`. Validate: non-empty key/trade, `Number.isFinite(value) && value > 0` (coerce strings via `Number()`), else inline error, no callback. No persistence in the component (parent wires the hook). No new design system.
- [ ] **Step 3** `npx tsc --noEmit` clean. Reason create/edit/reopen/NaN/deep-copy (mirror AssemblyEditorModal's proven guarantees).
- [ ] **Step 4** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add components/RateOverrideModal.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-2): rate-override cost-book editor modal"
```

---

### Task 5: Merge into `calculateAssemblyCost` + cost-book entry

**Files:** Modify `app/(tabs)/estimate/index.tsx`

- [ ] **Step 1** Import `useRateOverrides` (`@/hooks/useRateOverrides`) + `RateOverrideModal` (`@/components/RateOverrideModal`). In the estimate component call `const { overrides, laborRate, materialPrice, addOverride, updateOverride, deleteOverride } = useRateOverrides();`.

- [ ] **Step 2** The 2-line merge in `calculateAssemblyCost` (~:531-538) — change ONLY these resolutions, add `laborRate, materialPrice` to its `useCallback` dep array (currently `[materials]` at :541):
  - Replace `const found = materials.find(m => m.id === mat.materialId); const price = found ? found.baseBulkPrice : 15;` with:
    `const price = materialPrice(mat.materialId) ?? (materials.find(m => m.id === mat.materialId)?.baseBulkPrice ?? 15);`
  - Replace `const rate = LABOR_RATES.find(r => r.trade === lab.trade); laborCost += (rate?.hourlyRate ?? 25) * lab.hoursPerUnit * qty;` with:
    `const labRate = laborRate(lab.trade) ?? (LABOR_RATES.find(r => r.trade === lab.trade)?.hourlyRate ?? 25); laborCost += labRate * lab.hoursPerUnit * qty;`
  Nothing else in `calculateAssemblyCost` (or anywhere else in the estimator) changes. When `materialPrice`/`laborRate` return `undefined` (no override) the expression is byte-equivalent to today → zero-regression invariant holds.

- [ ] **Step 3** Cost-book entry + modal: add a "Cost book / My rates" affordance in the estimate screen's Labor and/or Assemblies tab area (reuse the existing button style D1b-1 used for "＋ New assembly"; match the screen's tab/header conventions). Local state `const [costBookOpen,setCostBookOpen]=useState(false)`. Render ONE `<RateOverrideModal visible={costBookOpen} overrides={overrides} materials={materials} onClose={()=>setCostBookOpen(false)} onAdd={o=>addOverride(o)} onUpdate={o=>updateOverride(o)} onDelete={id=>deleteOverride(id)} />` in the returned tree (both mobile/desktop trees if separate, once each). Pass the screen's REAL `materials` array/type to the modal prop. Do NOT alter the labor/material cart popups or any other estimator behavior.

- [ ] **Step 4** Gate: `npx tsc --noEmit` clean. Manual reasoning (report; `bun run start` if quick): add a Carpenter $95/hr override → an assembly with Carpenter labor costs at $95/hr; delete it → reverts byte-identical to LABOR_RATES default; material override likewise; no override → estimator/D1b-1/system assemblies/`buildLinkedEstimate`/`effectiveEstimateTotal` byte-unchanged; offline add survives; cart popups unaffected.

- [ ] **Step 5** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add "app/(tabs)/estimate/index.tsx"
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D1b-2): cost-book entry + rate-override merge in calculateAssemblyCost"
```

---

## Ship (controller, after final whole-impl review — NOT build)
1. FF-merge `claude/p0-launch-on-main` → `main`, push.
2. Apply the migration via Supabase MCP `apply_migration` (name `rate_overrides`, Task-1 SQL) — additive/idempotent; verify the table + own-RLS exist live.
3. THEN `eas update --branch production --message "D1b-2 GC rate-override cost-book"` (migration-before-OTA — `useRateOverrides` needs the table).
(Independent of H4's Netlify block — app + MCP migration only, no portal.)

## Self-Review
**Spec coverage:** §1 GC-scope → all tasks (no per-project compute path). §4.1 storage → T1. §4.2 hook → T3 (+T2 helpers). §4.3 single merge (precedence, zero-regression) → T5 Step 2. §4.4 UI → T4 + T5 Step 3. §5 error handling → T2 defensive map, T3 mirror-useCustomAssemblies (offline/isolation/safeJson), T4 validation, migration idempotent + migration-before-OTA. §6 verification → per-task gates. Per-project deferred (§7) — no task. No gaps.
**Placeholder scan:** Migration SQL + mapping helpers + the exact 2-line merge given verbatim; hook/modal are precise "mirror named shipped file X" directives against concrete anchors (the established no-placeholder approach used for every prior reuse task this session). RLS policy form pinned to verified baseline lines. No vague TODOs.
**Type/name consistency:** `RateOverride`/`RateOverrideRow`/`rateOverrideToRow`/`rowToRateOverride` consistent T2→T3→T4. Hook API (`overrides`,`laborRate`,`materialPrice`,`addOverride`,`updateOverride`,`deleteOverride`,`isLoading`) consistent T3→T5. `RateOverrideModal` props consistent T4→T5. Cache key `tertiary_rate_overrides` single (T3). Migration filename `20260518160000` sorts after D2's `20260518150000`. `kind` union `'labor'|'material'` + `key` semantics (trade / materialId) consistent throughout.
