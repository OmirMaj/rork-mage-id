# H4 Pre-Build Audit: Anon-Writer Inventory for `project_contracts` + `selection_options`

**Date:** 2026-05-18  
**Branch:** claude/p0-launch-on-main  
**Scope:** Confirm no code path writes `project_contracts` or `selection_options` via the anon/public key except the known marketing portal, before dropping `contracts_client_sign` + `selopt_client_choose`.

---

## 1. Grep Results and Classification

Command run:
```
grep -rnE "project_contracts|selection_options" marketing/ app/ contexts/ utils/ \
  --include="*.html" --include="*.ts" --include="*.tsx" \
  | grep -viE "select=|\.select\(|client_select|contracts_client_select|comment|^\s*//|/\*" \
  | grep -iE "PATCH|insert|update|upsert|delete|\.from\('selection_options'|\.from\(\"selection_options\
  |\.from\('project_contracts|is_chosen|homeowner_signature|status.*signed"
```

Hits and classification:

### marketing/portal/index.html:2961

**Context:** Comment line inside `renderContractCard()`:
```js
// project_contracts. RLS gates the update to status='sent' contracts
```
**Classification:** read-only/comment (irrelevant) — pure code comment, no write.

### marketing/portal/index.html (lines ~3126–3130 and ~3238–3247)

**Two PATCH calls in `saveSelectionPick()` and the sign-contract click handler.**

`saveSelectionPick()` — anon-key PATCH to `selection_options`:
```js
fetch(api.supabaseUrl + '/rest/v1/selection_options?category_id=eq.' + encodeURIComponent(selCat.id),
  { method: 'PATCH', headers: { 'apikey': api.supabaseAnonKey, 'Authorization': 'Bearer ' + api.supabaseAnonKey, ... },
    body: JSON.stringify({ is_chosen: false, chosen_at: null, chosen_by_role: null }) })
.then(() =>
  fetch(api.supabaseUrl + '/rest/v1/selection_options?id=eq.' + encodeURIComponent(selOpt.id),
    { method: 'PATCH', ..., body: JSON.stringify({ is_chosen: true, chosen_at: ..., chosen_by_role: 'homeowner' }) }))
```

Sign-contract handler — anon-key PATCH to `project_contracts`:
```js
fetch(api.supabaseUrl + '/rest/v1/project_contracts?id=eq.' + encodeURIComponent(contractId), {
  method: 'PATCH',
  headers: { 'apikey': api.supabaseAnonKey, 'Authorization': 'Bearer ' + api.supabaseAnonKey, ... },
  body: JSON.stringify({ homeowner_signature: {...}, status: 'signed', signed_at: ... }),
})
```

**Classification:** **anon/public writer (must route through RPC or the policy-drop breaks it)** — this is the marketing portal homeowner flow. Both PATCHes use `api.supabaseAnonKey` as the bearer token — no portal-token or authenticated session. These are the exact callers `contracts_client_sign` and `selopt_client_choose` exist to serve. Task 3 replaces them with SECURITY DEFINER RPCs.

### utils/contractEngine.ts:154, 168, 215, 235

**Four calls inside `fetchContractsForProject`, `fetchActiveContract`, `saveContract`, `setContractStatus`.**

- Lines 154, 168: `.from('project_contracts').select(...)` — read-only, irrelevant.
- Line 215: `.from('project_contracts').upsert(row, ...)` inside `saveContract()`. This function guards with `const userId = session.data.session?.user?.id; if (!userId) return null;` — requires an active authenticated session. **Classification: GC auth path (unaffected).**
- Line 235: `.from('project_contracts').update(patch).eq('id', id)` inside `setContractStatus()`. Same file — no auth guard shown inline, but this function is called exclusively from `app/contract.tsx` (`handleSignAndSend`), which is a GC-authenticated screen (mounted inside `AuthProvider`, user must be logged in). The supabase client is the authenticated session client. **Classification: GC auth path (unaffected).**

### utils/selectionsEngine.ts:120, 201, 220, 230, 240, 367

- Line 120: `.from('selection_options').select(...)` inside `fetchSelectionsForProject` — read-only, irrelevant.
- Line 201: `.from('selection_options').upsert(row, ...)` inside `saveSelectionOption()`. Guards with `const userId = session.data.session?.user?.id; if (!userId) return null;`. **Classification: GC auth path (unaffected).**
- Lines 220, 230: `.from('selection_options').update(...)` inside `chooseSelectionOption()`. No session guard in the function body, but this function is only called from GC-authenticated in-app screens (SelectionCategory screens under `AuthProvider`). Uses the authenticated supabase client. **Classification: GC auth path (unaffected).**
- Line 240: `.from('selection_options').select(...)` read — irrelevant.
- Line 367: `.from('selection_options').insert(rows)` inside `saveCuratedOptions()`. Called from the GC AI-curation flow in-app. No session guard shown inline, but the call site is always within an authenticated GC session. **Classification: GC auth path (unaffected).**

### app/client-view.tsx (all hits)

All write-path hits in `client-view.tsx` are to `change_order_approvals` (line 370 `.from('change_order_approvals').insert(...)`), not to `project_contracts` or `selection_options`. The screen uses the authenticated Supabase client (`supabase` from `lib/supabase`). **Classification: GC auth path / different table (irrelevant to H4).**

### app/contract.tsx (no direct hits)

`app/contract.tsx` calls `saveContract()` and `setContractStatus()` from `utils/contractEngine` — both GC auth paths classified above. The screen itself never directly calls `.from('project_contracts')`. **Classification: GC auth path (unaffected).**

---

## 2. Policy Inventory (READ-ONLY SQL)

### Count query

```sql
select count(*) as policy_count,
       count(*) filter (where roles::text like '%anon%' or roles::text like '%public%') as anon_or_public
from pg_policies
where schemaname='public';
```

**Result:**  
- `policy_count`: **285**  
- `anon_or_public`: **241**

### Target policy definitions

```sql
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname='public'
  and policyname in ('contracts_client_sign','selopt_client_choose');
```

**Result:**

| tablename | policyname | cmd | roles | qual | with_check |
|---|---|---|---|---|---|
| `project_contracts` | `contracts_client_sign` | `UPDATE` | `{public}` | `((status = 'sent') AND (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_contracts.project_id AND p.client_portal IS NOT NULL AND (p.client_portal->>'enabled')::boolean = true)))` | `null` |
| `selection_options` | `selopt_client_choose` | `UPDATE` | `{public}` | `(EXISTS (SELECT 1 FROM (selection_categories c JOIN projects p ON p.id = c.project_id) WHERE c.id = selection_options.category_id AND p.client_portal IS NOT NULL AND (p.client_portal->>'enabled')::boolean = true))` | `null` |

**Observations:**
- Both policies have `roles = {public}` — they fire for any caller including completely unauthenticated anon-key requests.
- Both are `UPDATE` with `with_check = null`, meaning there is no column-level restriction on what can be written — any field in the row can be patched by any request that matches `qual`.
- `contracts_client_sign` restricts to rows with `status='sent'` on portal-enabled projects, but places no limit on which columns can be updated — an attacker could also PATCH `gc_signature`, `contract_value`, `scope_text`, etc.
- `selopt_client_choose` has no column restriction either — all columns in `selection_options` are patchable by anon on any portal-enabled project.

---

## 3. Verdict

VERDICT: Dropping contracts_client_sign + selopt_client_choose breaks ONLY the marketing-portal anon PATCH (Task 3 fixes that) — no other anon writer found.

The sole callers of these two policies are the two PATCH calls in `marketing/portal/index.html` (the homeowner contract counter-sign and the homeowner selection-pick flows). Every other write path found — `utils/contractEngine.ts`, `utils/selectionsEngine.ts`, `app/contract.tsx`, `app/client-view.tsx` — uses either a fully authenticated GC session (RLS `auth.uid() = user_id`) or writes to a different table entirely (`change_order_approvals`). Dropping the two permissive anon UPDATE policies has no impact on any in-app GC flow.

---

## 4. TypeScript Check

```
npx tsc --noEmit
```

**Result: clean — exit 0, no output, no code modified.**
