# H4 — RLS Version-Control + Forgeable-Portal-Write Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed forgeable-contract-signature vulnerability (anon can sign any portal-enabled project's contract) and put the full live RLS into version-controlled migrations.

**Architecture:** Two SECURITY DEFINER RPCs (`portal_sign_contract`, `portal_choose_selection`) granted to `anon` become the only client write path; the permissive anon UPDATE policies are dropped. A separate baseline migration snapshots all live `public` RLS verbatim. The static portal HTML calls the RPCs instead of raw table PATCHes.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, PostgREST RPC), static HTML/JS portal (`marketing/portal/index.html`, Netlify-hosted), TypeScript/Expo repo (tsc gate only — no unit runner).

**Spec:** `docs/superpowers/specs/2026-05-18-h4-rls-portal-write-hardening-design.md` (@ 33d0da4). Read spec §5 (cutover) and §7 (verification) before starting.

---

## CRITICAL BUILD GUARDRAIL (every task)

**Build tasks author files ONLY. Do NOT apply migrations. Do NOT deploy anything. Do NOT call Supabase MCP `apply_migration`/`execute_sql` to mutate prod.** Implementer subagents MAY use Supabase MCP `execute_sql` **read-only** (SELECT against `pg_policies`/`information_schema`) to generate migration text. Applying the migrations, the Netlify-live confirmation, and the policy-drop sequencing are a **ship-time controller step** per spec §5 — out of scope for these tasks.

Per-task gate (no unit runner): `npx tsc --noEmit` clean repo-wide **and** the manual/read-only check named in the task. All paths relative to worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main` (branch `claude/p0-launch-on-main`).

---

## File Structure

- Create `docs/superpowers/audits/2026-05-18-h4-prebuild-findings.md` — Task 0 investigation output (committed, reviewable).
- Create `supabase/migrations/20260518120000_rls_baseline.sql` — Task 1, faithful idempotent snapshot of all live `public` policies (H4b).
- Create `supabase/migrations/20260518120100_portal_write_rpc_hardening.sql` — Task 2, the two RPCs + grants + the two policy drops (H4a).
- Modify `marketing/portal/index.html` (contract-sign block ~3220-3279; selection-save block ~3116-3131) — Task 3, RPC cutover.

Migration timestamps are deliberately ordered: `…120000_rls_baseline` BEFORE `…120100_portal_write_rpc_hardening`, so the baseline captures pre-fix prod (incl. the two soon-dropped policies) and the hardening migration removes them.

---

### Task 0: Pre-build investigation (other anon writers + policy dump sanity)

**Files:**
- Create: `docs/superpowers/audits/2026-05-18-h4-prebuild-findings.md`

**Why:** Spec §7 requires confirming nothing ELSE writes `project_contracts`/`selection_options` via the anon/public path before we drop those policies. The GC path (`auth.uid() = user_id`) is unaffected and fine; we only care about anon/public writers.

- [ ] **Step 1: Grep for other anon/public writers of the two tables**

Run from worktree root:
```bash
grep -rnE "project_contracts|selection_options" marketing/ app/ contexts/ utils/ \
  --include="*.html" --include="*.ts" --include="*.tsx" \
  | grep -viE "select=|\.select\(|client_select|contracts_client_select|comment|^\s*//|/\*" \
  | grep -iE "PATCH|insert|update|upsert|delete|\.from\('selection_options'|\.from\(\"selection_options|\.from\('project_contracts|is_chosen|homeowner_signature|status.*signed"
```
Also explicitly inspect: `app/client-view.tsx`, `app/contract.tsx`, `marketing/sub-portal/index.html` for any anon-key write to these tables/columns.

- [ ] **Step 2: Read-only confirm the live policy set is what the spec expects**

Using Supabase MCP `execute_sql` (project `nteoqhcswappxxjlpvap`), READ-ONLY:
```sql
select count(*) as policy_count,
       count(*) filter (where roles::text like '%anon%' or roles::text like '%public%') as anon_or_public
from pg_policies where schemaname='public';
```
And re-confirm the two target policies still exist exactly as the spec describes:
```sql
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname='public'
  and policyname in ('contracts_client_sign','selopt_client_choose');
```

- [ ] **Step 3: Write findings doc**

Create `docs/superpowers/audits/2026-05-18-h4-prebuild-findings.md` containing: (a) the grep results — for EACH hit, classify as "anon/public writer (must route through RPC or policy-drop breaks it)" vs "GC auth path (unaffected)" vs "read-only/comment (irrelevant)"; (b) the policy_count + anon_or_public numbers; (c) explicit verdict: **"Dropping `contracts_client_sign` + `selopt_client_choose` breaks ONLY the marketing-portal anon PATCH (Task 3 fixes that) — no other anon writer found"** OR a precise list of any other anon writer that Task 3's scope must also cover. If an unexpected anon writer is found, STOP and report it to the controller (it changes Task 2/3 scope).

- [ ] **Step 4: Gate**

`npx tsc --noEmit` → expect: clean (no code changed; sanity that the worktree compiles before we build on it).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/2026-05-18-h4-prebuild-findings.md
git commit -m "docs(H4): pre-build investigation — anon-writer audit + policy-set sanity"
```

---

### Task 1: H4b — `rls_baseline` migration (faithful idempotent snapshot)

**Files:**
- Create: `supabase/migrations/20260518120000_rls_baseline.sql`

**Why:** ~21 public tables' RLS exists only in the dashboard. This migration makes prod reproducible from `supabase/migrations/*`. It is a *verbatim snapshot of current prod* (it intentionally INCLUDES `contracts_client_sign`/`selopt_client_choose`; Task 2's later-timestamped migration removes them).

- [ ] **Step 1: Generate the table-enable block (read-only)**

Supabase MCP `execute_sql`, project `nteoqhcswappxxjlpvap`, READ-ONLY:
```sql
select string_agg('alter table public.'||quote_ident(tablename)||' enable row level security;', E'\n' order by tablename)
from (select distinct tablename from pg_policies where schemaname='public') t;
```

- [ ] **Step 2: Generate the policy DDL block (read-only)**

```sql
select string_agg(block, E'\n\n' order by tablename, policyname) from (
  select tablename, policyname,
    'drop policy if exists '||quote_ident(policyname)||' on public.'||quote_ident(tablename)||';'||E'\n'||
    'create policy '||quote_ident(policyname)||' on public.'||quote_ident(tablename)||
      ' as '||lower(permissive)||' for '||lower(cmd)||' to '||array_to_string(roles, ', ')||
      coalesce(' using ('||qual||')','')||
      coalesce(' with check ('||with_check||')','')||';' as block
  from pg_policies where schemaname='public'
) s;
```

These two queries are the deterministic generator — output is the migration body verbatim, no hand-transcription. **Policy and table names use `quote_ident` (NOT `quote_literal`)** — `CREATE/DROP POLICY` require an *identifier*; ~26 live policy names contain spaces (e.g. `client submits CO approvals`) and must render double-quoted (`"client submits CO approvals"`), simple names render bare. A single-quoted string-literal name is a SQL syntax error at apply time. Supabase roles in `roles` are `anon`/`authenticated`/`public`/`service_role`/`postgres` — bare-identifier-safe; `to public` is valid CREATE POLICY syntax.

- [ ] **Step 3: Write the migration file**

Create `supabase/migrations/20260518120000_rls_baseline.sql`:
```sql
-- H4b — RLS baseline. Verbatim, idempotent snapshot of ALL live public
-- RLS as of 2026-05-18 (prod project nteoqhcswappxxjlpvap). Makes prod
-- reproducible from migrations. Generated from pg_policies (see
-- docs/superpowers/plans/2026-05-18-h4-rls-portal-write-hardening.md Task 1).
-- This is a faithful pre-fix snapshot: it INCLUDES contracts_client_sign and
-- selopt_client_choose; migration 20260518120100 removes them.

-- ── Enable RLS (idempotent) ──
<<paste Step 1 output here>>

-- ── Policies (idempotent: drop if exists + create) ──
<<paste Step 2 output here>>
```
Replace the two `<<paste …>>` markers with the exact query outputs from Steps 1-2. Do not edit the generated DDL.

- [ ] **Step 4: Sanity-check the file**

Run:
```bash
grep -c "create policy" supabase/migrations/20260518120000_rls_baseline.sql
grep -nE "contracts_client_sign|selopt_client_choose" supabase/migrations/20260518120000_rls_baseline.sql
grep -cE "create policy '" supabase/migrations/20260518120000_rls_baseline.sql   # MUST be 0 — names must be identifiers, not 'literals'
grep -cE 'create policy "client submits CO approvals" on' supabase/migrations/20260518120000_rls_baseline.sql  # MUST be 1 — space-name double-quoted
```
Expected: `create policy` count equals the `policy_count` from Task 0 Step 2 (285); both `contracts_client_sign` and `selopt_client_choose` ARE present (this baseline is pre-fix); **zero** `create policy '` single-quoted-literal names (identifiers only); a known space-containing name renders double-quoted. No literal `<<paste` markers remain (`grep -n '<<paste' …` → no output).

- [ ] **Step 5: Gate**

`npx tsc --noEmit` → expect: clean (SQL-only change; confirms repo still compiles). **Do NOT apply this migration** (ship-time step).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260518120000_rls_baseline.sql
git commit -m "feat(H4b): version-control full live RLS as idempotent baseline migration"
```

---

### Task 2: H4a — `portal_write_rpc_hardening` migration (RPCs + drops)

**Files:**
- Create: `supabase/migrations/20260518120100_portal_write_rpc_hardening.sql`

**Why:** Replace the forgeable raw anon PATCH path with portalId-scoped, server-column-constructed SECURITY DEFINER RPCs, then remove the permissive anon UPDATE policies. Definer functions (owned by `postgres`, BYPASSRLS) still perform the write after the policy is dropped; GC policies and the anon SELECT policies are untouched.

- [ ] **Step 1: Write the migration file (complete, final SQL — no edits needed)**

Create `supabase/migrations/20260518120100_portal_write_rpc_hardening.sql`:
```sql
-- H4a — Forgeable-portal-write hardening.
-- Before: anon could PATCH /rest/v1/project_contracts?id=eq.<uuid> with only
-- the public anon key (no portal token), and the contracts_client_sign policy
-- had an empty WITH CHECK — a leaked contract UUID = forgeable binding
-- signature + arbitrary column write. Same anti-pattern on selection_options.
-- After: two SECURITY DEFINER RPCs are the only client write path; they scope
-- by the project's portalId (+ passcode when required), verify the row belongs
-- to that portal's project, and write only server-constructed columns. The
-- permissive anon UPDATE policies are dropped (GC auth.uid()=user_id policies
-- and anon SELECT policies are unchanged). Reversible: re-create the dropped
-- policies from 20260518120000_rls_baseline.sql if ever needed.

create or replace function public.portal_sign_contract(
  p_portal_id   text,
  p_contract_id uuid,
  p_signer_name text,
  p_passcode    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_portal     jsonb;
  v_status     text;
begin
  if p_signer_name is null or length(btrim(p_signer_name)) < 3 then
    raise exception 'sign_denied';
  end if;

  select id, client_portal
    into v_project_id, v_portal
    from projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean, false) = true
   limit 1;

  if v_project_id is null then
    raise exception 'sign_denied';
  end if;

  if coalesce((v_portal->>'requirePasscode')::boolean, false) = true
     and coalesce(v_portal->>'passcode', '') <> '' then
    if p_passcode is null or p_passcode <> (v_portal->>'passcode') then
      raise exception 'sign_denied';
    end if;
  end if;

  select status into v_status
    from project_contracts
   where id = p_contract_id and project_id = v_project_id
   limit 1;

  if v_status is null or v_status <> 'sent' then
    raise exception 'sign_denied';
  end if;

  update project_contracts
     set homeowner_signature = jsonb_build_object(
           'name', btrim(p_signer_name), 'role', 'homeowner', 'signedAt', now()),
         status    = 'signed',
         signed_at = now()
   where id = p_contract_id and project_id = v_project_id and status = 'sent';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_sign_contract(text,uuid,text,text) from public;
grant execute on function public.portal_sign_contract(text,uuid,text,text) to anon, authenticated;

create or replace function public.portal_choose_selection(
  p_portal_id   text,
  p_category_id uuid,
  p_option_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select id into v_project_id
    from projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean, false) = true
   limit 1;

  if v_project_id is null then
    raise exception 'selection_denied';
  end if;

  if not exists (
    select 1 from selection_categories c
     where c.id = p_category_id and c.project_id = v_project_id
  ) then
    raise exception 'selection_denied';
  end if;

  if not exists (
    select 1 from selection_options
     where id = p_option_id and category_id = p_category_id
  ) then
    raise exception 'selection_denied';
  end if;

  update selection_options
     set is_chosen = false, chosen_at = null, chosen_by_role = null
   where category_id = p_category_id;

  update selection_options
     set is_chosen = true, chosen_at = now(), chosen_by_role = 'homeowner'
   where id = p_option_id and category_id = p_category_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_choose_selection(text,uuid,uuid) from public;
grant execute on function public.portal_choose_selection(text,uuid,uuid) to anon, authenticated;

-- Remove the forgeable anon write paths. The RPCs above are now the only
-- client write route into these tables.
drop policy if exists "contracts_client_sign" on public.project_contracts;
drop policy if exists "selopt_client_choose"  on public.selection_options;
```

- [ ] **Step 2: Static sanity-check**

Run:
```bash
grep -cE "create or replace function" supabase/migrations/20260518120100_portal_write_rpc_hardening.sql   # expect 2
grep -cE "grant execute on function" supabase/migrations/20260518120100_portal_write_rpc_hardening.sql      # expect 2
grep -nE "drop policy if exists" supabase/migrations/20260518120100_portal_write_rpc_hardening.sql           # expect the 2 target policies
```
Confirm column/table names match the spec & live schema: `project_contracts(project_id, status, homeowner_signature, signed_at)`, `selection_categories(id, project_id)`, `selection_options(id, category_id, is_chosen, chosen_at, chosen_by_role)`, `projects.client_portal` jsonb with `portalId`/`enabled`/`requirePasscode`/`passcode` keys (all verified live in the spec). If any name mismatches, fix the SQL to match the live schema and re-check.

- [ ] **Step 3: Gate**

`npx tsc --noEmit` → expect: clean. **Do NOT apply this migration** (ship-time step per spec §5).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260518120100_portal_write_rpc_hardening.sql
git commit -m "feat(H4a): portal sign/selection via SECURITY DEFINER RPC; drop forgeable anon UPDATE policies"
```

---

### Task 3: Portal HTML cutover (call the RPCs, not raw PATCH)

**Files:**
- Modify: `marketing/portal/index.html` (contract-sign handler ~3236-3255; `saveSelectionPick` ~3116-3131)

**Why:** Once the policies are dropped, the raw anon PATCHes 401. The portal must call the new RPCs. Same anon-key headers, different endpoint. Preserve all existing success/failure UX (confetti, `notifyEvent`, reload, error alert). Pass `p_passcode: (data && data.passcode) || null` — the validated passcode is not retained client-side (it gates UI reveal then is discarded; legacy snapshot may still carry `data.passcode`); the RPC's security comes from portalId-scoping + row-ownership + server-constructed columns, with passcode as an extra check only when present. Do NOT add new passcode plumbing (YAGNI; spec §4.4).

- [ ] **Step 1: Replace the contract-sign fetch**

In `marketing/portal/index.html`, find the contract-sign `fetch` (the block starting `fetch(api.supabaseUrl.replace(/\/+$/,'') + '/rest/v1/project_contracts?id=eq.' + encodeURIComponent(contractId), {` with `method: 'PATCH'`).

Replace **only** the `fetch(...)` call args (URL + options object) — keep the surrounding `.then(function (r) { if (!r.ok) throw … notifyEvent('contract_signed', …) … fireWebConfetti(); … reload … }).catch(…)` chain exactly as-is.

OLD:
```js
    fetch(api.supabaseUrl.replace(/\/+$/,'') + '/rest/v1/project_contracts?id=eq.' + encodeURIComponent(contractId), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': api.supabaseAnonKey,
        'Authorization': 'Bearer ' + api.supabaseAnonKey,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        homeowner_signature: {
          name: typedName,
          role: 'homeowner',
          signedAt: new Date().toISOString(),
        },
        status: 'signed',
        signed_at: new Date().toISOString(),
      }),
    })
```
NEW:
```js
    fetch(api.supabaseUrl.replace(/\/+$/,'') + '/rest/v1/rpc/portal_sign_contract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': api.supabaseAnonKey,
        'Authorization': 'Bearer ' + api.supabaseAnonKey,
      },
      body: JSON.stringify({
        p_portal_id: api.portalId,
        p_contract_id: contractId,
        p_signer_name: typedName,
        p_passcode: (data && data.passcode) || null,
      }),
    })
```

- [ ] **Step 2: Replace the selection-save fetches**

In `saveSelectionPick(target, data, selCat, selOpt)`, replace the two chained `fetch` PATCH calls with one RPC POST. Keep `target.style.opacity='0.6';` before it and the `.then(function () { … notifyEvent('selection_chosen', …) … })` / `.catch(…)` after it exactly as-is.

OLD:
```js
    fetch(api.supabaseUrl.replace(/\/+$/,'') + '/rest/v1/selection_options?category_id=eq.' + encodeURIComponent(selCat.id),
      { method: 'PATCH', headers: headers, body: JSON.stringify({ is_chosen: false, chosen_at: null, chosen_by_role: null }) })
    .then(function () {
      return fetch(api.supabaseUrl.replace(/\/+$/,'') + '/rest/v1/selection_options?id=eq.' + encodeURIComponent(selOpt.id),
        { method: 'PATCH', headers: headers, body: JSON.stringify({ is_chosen: true, chosen_at: new Date().toISOString(), chosen_by_role: 'homeowner' }) });
    })
```
NEW:
```js
    fetch(api.supabaseUrl.replace(/\/+$/,'') + '/rest/v1/rpc/portal_choose_selection',
      { method: 'POST', headers: headers, body: JSON.stringify({
          p_portal_id: api.portalId, p_category_id: selCat.id, p_option_id: selOpt.id }) })
```
(`headers` already includes `Content-Type`/`apikey`/`Authorization`/`Prefer` — fine for an RPC POST. The two-write atomicity now happens server-side inside `portal_choose_selection`.)

- [ ] **Step 3: Verify the surrounding chains are intact**

```bash
grep -n "rpc/portal_sign_contract\|rpc/portal_choose_selection" marketing/portal/index.html   # expect 1 each
grep -n "rest/v1/project_contracts?id=eq\|rest/v1/selection_options?" marketing/portal/index.html  # expect: NO write (PATCH) hits remain
grep -n "notifyEvent('contract_signed'\|notifyEvent('selection_chosen'\|fireWebConfetti" marketing/portal/index.html  # success paths still present
```
Expected: exactly one `rpc/portal_sign_contract` and one `rpc/portal_choose_selection`; no remaining `selection_options?` or `project_contracts?id=eq` write call; the `notifyEvent`/confetti success paths unchanged.

- [ ] **Step 4: Gate**

`npx tsc --noEmit` → expect: clean (HTML/JS only; confirms TS repo unaffected). Manual read-through of both edited blocks: success and error branches still wired, no dangling `.then` referencing removed second fetch.

- [ ] **Step 5: Commit**

```bash
git add marketing/portal/index.html
git commit -m "feat(H4a): portal calls portal_sign_contract / portal_choose_selection RPCs (no raw anon PATCH)"
```

---

## Ship-time controller steps (NOT part of the build — spec §5, executed after final review)

Recorded here so the build stays code-only and the cutover is unambiguous. **Do not perform these in build tasks.**

1. FF-merge `claude/p0-launch-on-main` → `main`; `git push origin main` (triggers Netlify marketing rebuild).
2. Supabase MCP `apply_migration` `20260518120000_rls_baseline` — idempotent, mirrors current prod, breaks nothing.
3. **Gate:** poll `curl -s https://mageid.app/portal/index.html` until it contains `rpc/portal_sign_contract` AND no longer contains `project_contracts?id=eq` (new portal HTML live; Netlify build latency).
4. Supabase MCP `apply_migration` `20260518120100_portal_write_rpc_hardening` — adds RPCs (safe even before HTML cutover) then drops the two policies (safe now HTML is live). Reversible via the baseline.
5. Verify (spec §7): positive RPC sign/selection works end-to-end + GC app reflects it; **negative — old raw `PATCH /rest/v1/project_contracts?id=eq.<id>` with only the anon key now fails (401/empty)** and a cross-portal call is denied.
6. OTA only if app TS changed (per Task 0 findings). Portal HTML is not in the Expo bundle — a marketing-only change needs no `eas update`.

---

## Self-Review

**Spec coverage:** §1/§3/§4.1-4.2 → Task 2 (RPCs). §4.3 (drop policies) → Task 2 Step 1 tail. §4.4 (portal HTML, passcode decision) → Task 3. §4.5 (H4b baseline) → Task 1. §5 (cutover) → Ship-time section. §6 (generic errors `sign_denied`/`selection_denied`) → Task 2 SQL. §7 (pre-build investigation + verification) → Task 0 + ship-time step 5. No gaps.

**Placeholder scan:** The only intentional fill-ins are Task 1's two `<<paste … output here>>` markers — these are outputs of the deterministic generator queries given verbatim in the same task, with a Step 4 grep asserting no `<<paste` marker survives. All RPC/HTML code is complete and final. No "TBD"/"handle errors"/"similar to".

**Type/name consistency:** RPC signatures identical across spec, Task 2 SQL, grants, and Task 3 call bodies: `portal_sign_contract(p_portal_id text, p_contract_id uuid, p_signer_name text, p_passcode text)` and `portal_choose_selection(p_portal_id text, p_category_id uuid, p_option_id uuid)`. Portal request keys (`p_portal_id`/`p_contract_id`/`p_signer_name`/`p_passcode`; `p_portal_id`/`p_category_id`/`p_option_id`) match the SQL parameter names (PostgREST RPC binds JSON keys to named args). Column/table names match the live schema verified in the spec. Migration filename timestamps ordered baseline (120000) before hardening (120100).
