# H4 — RLS Version-Control + Forgeable-Portal-Write Hardening — Design

Source: `docs/superpowers/audits/2026-05-17-prebroad-testflight-hardening-audit.md` item **H4**.
Pre-broad-TestFlight gate. Migration + edge/RPC + one static-HTML change. NOT pure-OTA.

## 1. Problem (verified against live prod, project `nteoqhcswappxxjlpvap`)

H4 has two halves:

### H4a — Confirmed exploitable vulnerability (High)

Live RLS policy `contracts_client_sign` on `project_contracts`:

- `cmd = UPDATE`, `roles = {public}` (⊇ `anon`)
- `qual` = `status = 'sent' AND EXISTS(select 1 from projects p where p.id = project_contracts.project_id AND p.client_portal IS NOT NULL AND (p.client_portal->>'enabled')::bool = true)`
- `with_check` = **empty**

The static portal (`marketing/portal/index.html:3238`) counter-signs via a raw anon REST `PATCH /rest/v1/project_contracts?id=eq.<contractId>` authenticated **only by the public anon key** (embedded in the static page) — no `portalId`, no passcode, no token in the request. Exploit consequences:

1. Anyone holding the public anon key (it is in public static HTML) **and** a contract UUID can set `status='signed'` + a forged `homeowner_signature` on **any** contract of **any** project that has an enabled client portal. Contract/project UUIDs leak via portal links, the public profile, PDFs, snapshots, emails. → **Forgeable execution of a legally-binding construction contract.**
2. The empty `with_check` means the UPDATE is not constrained to the intended columns or the post-state — an attacker can mutate arbitrary `project_contracts` columns on those rows.

`selection_options.selopt_client_choose` is the same anti-pattern (anon UPDATE, no token, empty `with_check`, gated only on "project has an enabled portal") at lower severity (selections are not legally binding; lower $ impact, but still an unauthenticated cross-project write).

INSERT-only anon policies (`change_order_approvals.client submits CO approvals`, `portal_messages.client posts messages to known portals`) are gated by `is_published_portal(portal_id)` — weaker class, additive-only, **out of scope** for H4a (audit scoped H4a to contracts/selections; widening is YAGNI here).

`portalId` is **not a secret**: generated as `` `portal-${projectId.slice(0,8)}-${Date.now().toString(36)}` `` (`app/client-portal-setup.tsx:225`, `app/project-detail.tsx:3070`). It is the access credential the GC distributes privately, but it is timestamp-derived and low-entropy. The fix therefore does **not** rely on `portalId` as a strong secret — it relies on (a) server-constructed column writes (kills the arbitrary-write), (b) requiring the correct `portalId` for the contract's own project (raises the bar to parity with the rest of the portal-write surface), (c) the portal passcode when `requirePasscode` is set, and (d) removing the raw anon UPDATE path entirely.

### H4b — RLS not in version control

~21 public tables have RLS enabled with policies that exist **only in the Supabase dashboard** — not reproducible from `supabase/migrations/*`, not reviewable in PRs, and lost on any rebuild-from-migrations. Verified present in prod (the earlier "tables with no RLS" alarm was a false positive — all flagged tables have RLS ON with policies).

## 2. Goals / Non-goals

**Goals:** (1) Close H4a so anon can no longer forge a contract signature or arbitrary-write `project_contracts`/`selection_options`. (2) Commit the full live RLS as idempotent, version-controlled migrations so prod is reproducible from `supabase/migrations/*`. (3) No regression to the legitimate homeowner portal sign/selection flow or the GC app.

**Non-goals:** Re-architecting the portal auth model; strengthening `portalId` entropy; touching the INSERT-only anon policies; any schema change to `projects.client_portal`. RevenueCat/tier logic untouched.

## 3. Approach decision

**Chosen: SECURITY DEFINER RPCs granted to `anon`, + drop the permissive anon UPDATE policies.** (Considered and rejected: a new service-role *edge function* mirroring `validate-portal-passcode`. Rejected because the SECURITY DEFINER RPC path is the pattern this codebase already uses for exactly this class of problem — the architect/engineer reply portal "fetches the doc via SECURITY DEFINER RPC" per `marketing/netlify.toml:30-36` — it is migration-only so it folds into H4b's version-control goal, removes the edge-fn deploy + a Netlify-vs-deploy race, and is atomic in-DB. The portal keeps using the same anon key, just calls `POST /rest/v1/rpc/<fn>` instead of a table PATCH.)

SECURITY DEFINER functions created via migration are owned by `postgres` (BYPASSRLS), so they perform the privileged write even after the permissive anon policy is dropped. GC-side policies (`contracts_gc_*`, `selopt_gc_all`, all `auth.uid() = user_id`) are **unchanged** — the GC app is unaffected. The anon SELECT policies that drive portal *display* (`contracts_client_select`, `selopt_client_select`) are **unchanged**.

## 4. Architecture

### 4.1 RPC: `portal_sign_contract`

```
portal_sign_contract(
  p_portal_id  text,
  p_contract_id uuid,
  p_signer_name text,
  p_passcode   text default null
) returns jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Validation, in order (every failure → `RAISE EXCEPTION` with a single generic message `'sign_denied'` so the function never reveals which check failed):

1. `p_signer_name` trimmed length ≥ 3.
2. Resolve project: `select id, client_portal from projects where client_portal->>'portalId' = p_portal_id and coalesce((client_portal->>'enabled')::boolean,false)=true` → exactly one row, else deny.
3. If `client_portal->>'requirePasscode' = 'true'` and `client_portal->>'passcode'` is non-empty: require `p_passcode = client_portal->>'passcode'` (plain equality; PostgREST/gateway per-IP throttling is the brute-force control, consistent with the coarse passcode model — true constant-time is not meaningfully achievable through PostgREST and is disproportionate vs. the current "no check at all").
4. Contract must belong to the project and be signable: `select status from project_contracts where id = p_contract_id and project_id = <resolved project id>` → exists and `status = 'sent'`, else deny.
5. Perform exactly the intended write (server-constructed — client cannot inject columns):
   ```sql
   update project_contracts
      set homeowner_signature = jsonb_build_object('name', p_signer_name, 'role', 'homeowner', 'signedAt', now()),
          status = 'signed',
          signed_at = now()
    where id = p_contract_id and project_id = <project id> and status = 'sent';
   ```
6. Return `jsonb_build_object('ok', true)`.

Grants: `revoke all on function portal_sign_contract(text,uuid,text,text) from public; grant execute on function portal_sign_contract(text,uuid,text,text) to anon, authenticated;`

### 4.2 RPC: `portal_choose_selection`

```
portal_choose_selection(
  p_portal_id   text,
  p_category_id uuid,
  p_option_id   uuid
) returns jsonb  -- same LANGUAGE/SECURITY/search_path
```

1. Resolve project via `portalId` enabled (same as 4.1 step 2; generic error `'selection_denied'`).
2. Category must belong to that project: `select 1 from selection_categories c where c.id = p_category_id and c.project_id = <project id>`.
3. Option must belong to that category: `select 1 from selection_options where id = p_option_id and category_id = p_category_id`.
4. Atomic swap (replicates the portal's current clear-then-set, made atomic):
   ```sql
   update selection_options set is_chosen=false, chosen_at=null, chosen_by_role=null
     where category_id = p_category_id;
   update selection_options set is_chosen=true, chosen_at=now(), chosen_by_role='homeowner'
     where id = p_option_id and category_id = p_category_id;
   ```
5. Return `jsonb_build_object('ok', true)`. Grants: `revoke all on function portal_choose_selection(text,uuid,uuid) from public; grant execute on function portal_choose_selection(text,uuid,uuid) to anon, authenticated;`

### 4.3 Policy changes (in the H4a migration, after the RPCs)

```sql
drop policy if exists "contracts_client_sign" on project_contracts;
drop policy if exists "selopt_client_choose"  on selection_options;
```

No replacement — the RPCs are now the only client write path. (Reversible: re-create from the H4b baseline if ever needed.)

### 4.4 Portal HTML (`marketing/portal/index.html`)

- Contract sign (~3238): replace the `PATCH /rest/v1/project_contracts?id=eq...` with
  `POST /rest/v1/rpc/portal_sign_contract` (same `apikey`/`Bearer anonKey` headers, `Content-Type: application/json`), body `{ p_portal_id: api.portalId, p_contract_id: contractId, p_signer_name: typedName, p_passcode: <passcode the gate already collected, or null> }`. Keep the existing success path (notify `contract_signed`, confetti, reload) on `r.ok`; keep the existing failure UX.
- Selection choose (~3126-3130): replace the two `PATCH /rest/v1/selection_options` calls with one `POST /rest/v1/rpc/portal_choose_selection` body `{ p_portal_id: api.portalId, p_category_id: selCat.id, p_option_id: selOpt.id }`. Preserve the existing optimistic-UI/confirm modal behavior and error handling.
- The passcode value: confirm how the portal currently holds the validated passcode in scope (the `validate-portal-passcode` gate). If it is not retained client-side, pass `null` and rely on validation steps 2+4 (portalId + contract-belongs-to-project); document this. Do **not** add new passcode plumbing if it isn't already there (YAGNI; the security gain over current state is already large).

### 4.5 H4b — RLS baseline migration

A single migration `supabase/migrations/<ts>_rls_baseline.sql` that, for **every** `public` table that currently has any policy, emits idempotent DDL mirroring live prod **exactly**:

```sql
alter table public.<t> enable row level security;
drop policy if exists "<name>" on public.<t>;
create policy "<name>" on public.<t> for <cmd> to <roles> using (<qual>) with check (<with_check>);
```

(Omit `using`/`with check` clauses that are null in `pg_policies`; `cmd=ALL` → no per-cmd keyword.) The implementer generates this by dumping the **full** `pg_policies` for `schemaname='public'` and transcribing verbatim. The two soon-removed policies (`contracts_client_sign`, `selopt_client_choose`) are **included** in the baseline (it is a faithful snapshot of pre-fix prod); the later-timestamped H4a migration is what removes them. Timestamp ordering: `rls_baseline` first, `portal_write_rpc_hardening` second.

## 5. Cutover sequence (prod-safety crux)

Netlify auto-builds the marketing site on push to `main`; portal HTML is served `Cache-Control: max-age=0, must-revalidate` (`marketing/netlify.toml:78-81`) so the new HTML is authoritative the instant Netlify finishes (~1-2 min, no stale-HTML cache).

1. Build + commit on `claude/p0-launch-on-main`: both migration files + portal HTML edits. `npx tsc --noEmit` clean (portal HTML is not TS; tsc still gates the repo).
2. FF-merge → `git push origin main` (triggers Netlify marketing rebuild).
3. Apply `rls_baseline` migration via Supabase MCP `apply_migration` — idempotent, mirrors current prod, breaks nothing.
4. **Gate:** confirm the new portal HTML is live — `curl -s https://mageid.app/portal/index.html` must contain `rpc/portal_sign_contract` and must NOT contain the old `project_contracts?id=eq` PATCH. Poll until true (Netlify build latency).
5. Apply `portal_write_rpc_hardening` migration (adds both RPCs — additive/safe even pre-HTML-cutover since nothing calls them yet — then drops the two permissive policies; safe now that the new HTML is live). Fully reversible (re-create the dropped policies from the baseline).
6. OTA: only if app TS changed. Pre-build investigation (§7) determines this. Portal HTML is NOT in the Expo bundle, so a marketing-only change does not need `eas update`.

This ordering means the only theoretical breakage window is a real homeowner mid-contract-sign during the ~1-2 min Netlify build, on a pre-broad-TestFlight app with a near-zero concurrent user base, and it is reversible. Within the autonomous-execution envelope.

## 6. Error handling

- RPC denials: single generic exception message per RPC (`sign_denied` / `selection_denied`) — never reveal which check failed (no portal/contract existence oracle). PostgREST surfaces this as HTTP 400; the portal keeps its existing "could not sign / try again" UX.
- RPC success returns `{ ok: true }`; portal treats any non-2xx or `ok !== true` as failure (re-enable button, alert).
- Migrations: idempotent (`drop policy if exists`, `create or replace function`) so re-application is safe; `apply_migration` records them in the migration history.

## 7. Verification & pre-build investigation

**Pre-build investigation (blocks the policy-drop task):** grep the app (`app/`, `contexts/`, `utils/`) and `marketing/` for any OTHER writer of `project_contracts` / `selection_options` `is_chosen|status|*_signature` that depends on the **anon/public** path (the GC `auth.uid()=user_id` path is unaffected and fine). Specifically check `app/client-view.tsx`, `app/contract.tsx`, and `marketing/sub-portal/`. Any anon writer found must be routed through the new RPC, or the policy-drop must be scoped so it does not break it. If a blocking unknown surfaces, document it in the plan and adapt scope — do not silently break a path.

**Gate (no unit runner):**
1. `npx tsc --noEmit` clean repo-wide.
2. Manual/`curl` walkthrough against deployed prod:
   - Positive: `POST /rest/v1/rpc/portal_sign_contract` with a valid `(portalId, sent-contract id, name)` flips it to `signed` with the homeowner signature; portal sign button works end-to-end and the GC app shows the contract as signed.
   - Positive: `portal_choose_selection` sets the chosen option; GC `selections.tsx` reflects it.
   - **Negative (the security proof):** the old raw `PATCH /rest/v1/project_contracts?id=eq.<id>` with only the anon key now returns 401/403/empty (policy dropped) — an attacker can no longer forge a signature. A cross-portal call (valid portalId for project A, contract id from project B) is denied.
3. Final whole-impl review (opus).

## 8. Out of scope / future

INSERT-only anon policies hardening; `portalId` entropy upgrade; `client-view.tsx` in-app homeowner write parity beyond what §7 finds; rate-limiting beyond gateway defaults. Logged here, not built now.
