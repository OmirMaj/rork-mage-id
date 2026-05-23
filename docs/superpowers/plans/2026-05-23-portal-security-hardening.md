# Client Portal Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. NOTE: the SQL is security-critical and the portal HTML is a 226 KB single file — execute carefully, prefer inline execution with close review.

**Goal:** Make a server-managed 192-bit `accessToken` the gate for client KEY DECISIONS (sign contract, choose selection, submit budget proposal); reads stay open; signing token-required immediately.

**Architecture:** A Supabase migration backfills + trigger-manages the token and rewrites the decision RPCs to require it (+ audit + throttle). The portal HTML reads `?t=` and passes it. The app puts the token in the share link. No client crypto, no new app native dep.

**Tech Stack:** Postgres/Supabase (plpgsql, SECURITY DEFINER RPCs, RLS), static portal HTML (vanilla JS fetch → PostgREST), React Native app.

**Spec:** `docs/superpowers/specs/2026-05-23-portal-security-hardening-design.md` (@ 8f26df4).

---

## File Structure
- **Create** `supabase/migrations/20260523<ts>_portal_access_token.sql` — backfill + trigger + audit table + throttle + rewritten decision RPCs + new budget RPC + drop anon budget-insert policy. (The whole server change in one migration.)
- **Modify** `marketing/portal/index.html` — read `?t=`, pass token to the 3 decision calls, graceful no-token UX.
- **Modify** `utils/portalSnapshot.ts` — `buildShortPortalUrl` appends the token; assert token never enters the snapshot.
- **Modify** `app/client-portal-setup.tsx` — include token in Copy/Share link; "finalizing secure link" until present.

---

## Task 1: Migration — token-gated decision RPCs + audit

**Files:** Create `supabase/migrations/20260523<ts>_portal_access_token.sql`

- [ ] **Step 1: Write the migration** (full SQL below). Use a real UTC timestamp for `<ts>` (e.g. `date -u +%Y%m%d%H%M%S`).

```sql
-- H4b — accessToken gate on client decisions. Follows H4a (20260518120100),
-- which scoped decisions to portalId+enabled; but portalId is low-entropy
-- (portal-<8hex>-<base36 ts>), so knowing it sufficed. After: decisions
-- require a 192-bit accessToken (projects.client_portal.accessToken), sent via
-- the share-link ?t= param. Reads (snapshot, messages) intentionally unchanged.
--
-- Reversible: drop trigger trg_portal_access_token + function
-- portal_set_access_token; restore prior RPC signatures from 20260518120100;
-- re-create policy "portal can submit proposals"; drop portal_submit_budget_proposal,
-- portal_check_throttle, portal_decision_audit. (Backfilled tokens are harmless.)

-- 1) Backfill existing portals that lack a token.
update public.projects
   set client_portal = client_portal || jsonb_build_object('accessToken', encode(gen_random_bytes(24),'hex'))
 where client_portal ? 'portalId'
   and coalesce(client_portal->>'accessToken','') = '';

-- 2) Sticky trigger — ensure/preserve a token whenever a portal row is written.
create or replace function public.portal_set_access_token()
returns trigger language plpgsql as $$
begin
  if new.client_portal is not null and new.client_portal ? 'portalId'
     and coalesce(new.client_portal->>'accessToken','') = '' then
    new.client_portal := new.client_portal || jsonb_build_object(
      'accessToken',
      coalesce(nullif(old.client_portal->>'accessToken',''), encode(gen_random_bytes(24),'hex')));
  end if;
  return new;
end; $$;
drop trigger if exists trg_portal_access_token on public.projects;
create trigger trg_portal_access_token
  before insert or update on public.projects
  for each row execute function public.portal_set_access_token();

-- 3) Decision audit (forensics + throttle source).
create table if not exists public.portal_decision_audit (
  id uuid primary key default gen_random_uuid(),
  portal_id text not null,
  project_id uuid,
  action text not null,           -- 'sign' | 'selection' | 'budget'
  success boolean not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_audit_portal_time
  on public.portal_decision_audit (portal_id, created_at desc);
alter table public.portal_decision_audit enable row level security;
drop policy if exists "gc reads own portal audit" on public.portal_decision_audit;
create policy "gc reads own portal audit" on public.portal_decision_audit
  for select to authenticated
  using (project_id is not null and exists (
    select 1 from public.projects p
     where p.id = portal_decision_audit.project_id and p.user_id = auth.uid()));

-- 4) Throttle helper — >20 failed attempts per portal in 10 min => rate_limited.
create or replace function public.portal_check_throttle(p_portal_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_fails int;
begin
  select count(*) into v_fails from public.portal_decision_audit
   where portal_id = p_portal_id and success = false
     and created_at > now() - interval '10 minutes';
  if v_fails > 20 then raise exception 'rate_limited'; end if;
end; $$;

-- 5) Rewrite portal_sign_contract WITH the token gate.
--    DROP the old 4-arg signature first so no un-gated overload remains.
drop function if exists public.portal_sign_contract(text,uuid,text,text);
create or replace function public.portal_sign_contract(
  p_portal_id text, p_contract_id uuid, p_signer_name text,
  p_passcode text default null, p_access_token text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_portal jsonb; v_status text;
begin
  perform public.portal_check_throttle(p_portal_id);
  select id, client_portal into v_project_id, v_portal from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean,false) = true limit 1;
  -- access token gate (new boundary; signing token-required immediately)
  if v_project_id is null or p_access_token is null
     or coalesce(v_portal->>'accessToken','') = '' or p_access_token <> (v_portal->>'accessToken') then
    insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
      values (p_portal_id,v_project_id,'sign',false,jsonb_build_object('reason','token'));
    raise exception 'sign_denied';
  end if;
  if p_signer_name is null or length(btrim(p_signer_name)) < 3 then
    insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
      values (p_portal_id,v_project_id,'sign',false,jsonb_build_object('reason','name'));
    raise exception 'sign_denied';
  end if;
  if p_passcode is not null and coalesce(v_portal->>'passcode','') <> '' and p_passcode <> (v_portal->>'passcode') then
    insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
      values (p_portal_id,v_project_id,'sign',false,jsonb_build_object('reason','passcode'));
    raise exception 'sign_denied';
  end if;
  select status into v_status from public.project_contracts
   where id = p_contract_id and project_id = v_project_id limit 1;
  if v_status is null or v_status <> 'sent' then
    insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
      values (p_portal_id,v_project_id,'sign',false,jsonb_build_object('reason','status'));
    raise exception 'sign_denied';
  end if;
  update public.project_contracts
     set homeowner_signature = jsonb_build_object('name',btrim(p_signer_name),'role','homeowner','signedAt',now()),
         status='signed', signed_at=now()
   where id = p_contract_id and project_id = v_project_id and status='sent';
  insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
    values (p_portal_id,v_project_id,'sign',true,jsonb_build_object('contract',p_contract_id,'signer',btrim(p_signer_name)));
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.portal_sign_contract(text,uuid,text,text,text) from public;
grant execute on function public.portal_sign_contract(text,uuid,text,text,text) to anon, authenticated;

-- 6) Rewrite portal_choose_selection WITH the token gate (drop old 3-arg first).
drop function if exists public.portal_choose_selection(text,uuid,uuid);
create or replace function public.portal_choose_selection(
  p_portal_id text, p_category_id uuid, p_option_id uuid, p_access_token text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_portal jsonb;
begin
  perform public.portal_check_throttle(p_portal_id);
  select id, client_portal into v_project_id, v_portal from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean,false) = true limit 1;
  if v_project_id is null or p_access_token is null
     or coalesce(v_portal->>'accessToken','') = '' or p_access_token <> (v_portal->>'accessToken') then
    insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
      values (p_portal_id,v_project_id,'selection',false,jsonb_build_object('reason','token'));
    raise exception 'selection_denied';
  end if;
  if not exists (select 1 from public.selection_categories c where c.id = p_category_id and c.project_id = v_project_id) then
    raise exception 'selection_denied';
  end if;
  if not exists (select 1 from public.selection_options where id = p_option_id and category_id = p_category_id) then
    raise exception 'selection_denied';
  end if;
  update public.selection_options set is_chosen=false, chosen_at=null, chosen_by_role=null where category_id = p_category_id;
  update public.selection_options set is_chosen=true, chosen_at=now(), chosen_by_role='homeowner'
   where id = p_option_id and category_id = p_category_id;
  insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
    values (p_portal_id,v_project_id,'selection',true,jsonb_build_object('category',p_category_id,'option',p_option_id));
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.portal_choose_selection(text,uuid,uuid,text) from public;
grant execute on function public.portal_choose_selection(text,uuid,uuid,text) to anon, authenticated;

-- 7) Budget proposal: token-gated RPC + drop the permissive anon insert policy.
create or replace function public.portal_submit_budget_proposal(
  p_portal_id text, p_access_token text, p_amount numeric, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_portal jsonb;
begin
  perform public.portal_check_throttle(p_portal_id);
  select id, client_portal into v_project_id, v_portal from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean,false) = true limit 1;
  if v_project_id is null or p_access_token is null
     or coalesce(v_portal->>'accessToken','') = '' or p_access_token <> (v_portal->>'accessToken') then
    insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
      values (p_portal_id,v_project_id,'budget',false,jsonb_build_object('reason','token'));
    raise exception 'budget_denied';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'budget_denied'; end if;
  insert into public.portal_budget_proposals(project_id, portal_id, amount, note, status)
    values (v_project_id::text, p_portal_id, p_amount, btrim(coalesce(p_note,'')), 'pending');
  insert into public.portal_decision_audit(portal_id,project_id,action,success,detail)
    values (p_portal_id,v_project_id,'budget',true,jsonb_build_object('amount',p_amount));
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.portal_submit_budget_proposal(text,text,numeric,text) from public;
grant execute on function public.portal_submit_budget_proposal(text,text,numeric,text) to anon, authenticated;

drop policy if exists "portal can submit proposals" on public.portal_budget_proposals;
```

- [ ] **Step 2: VERIFY the budget table column names** before finalizing (the insert in §7 assumes `project_id text, portal_id, amount, note, status`). Run: `grep -rn "portal_budget_proposals" supabase/migrations/*.sql` and read the create-table (or the prior REST insert payload in `marketing/portal/index.html` around line 4140-4170). Adjust the `insert ... values` columns to match exactly. **Do not finalize with assumed columns.**

- [ ] **Step 3: Self-check the SQL** by reading: old signatures dropped before re-create (§5/§6) ✓; token-null ⇒ denied ✓; audit on every path ✓; throttle first ✓; anon budget policy dropped ✓; grants to anon+authenticated ✓.

- [ ] **Step 4: Commit** (migration only — applied later, confirm-gated):
```bash
git add supabase/migrations/20260523*_portal_access_token.sql
git commit -m "feat(portal): H4b — accessToken gate on decision RPCs + audit (migration)"
```

---

## Task 2: Portal HTML — send the token

**Files:** Modify `marketing/portal/index.html`

- [ ] **Step 1: Parse `?t=` once** near the existing URL parsing (there's already `new URLSearchParams(window.location.search)` ~line 4496 and `parsePortalIdFromPath()` ~5385). Capture a module-level `var PORTAL_ACCESS_TOKEN = new URLSearchParams(window.location.search).get('t') || null;` early (top of the main script scope, before the snapshot loads).

- [ ] **Step 2: choose_selection** (~line 3152-3154): add `p_access_token: PORTAL_ACCESS_TOKEN` to the JSON body alongside `p_portal_id`.

- [ ] **Step 3: sign_contract** (~line 3261-3272): add `p_access_token: PORTAL_ACCESS_TOKEN` to the body (next to `p_portal_id`/`p_passcode`).

- [ ] **Step 4: budget** (~line 3992-4170): replace the direct REST `POST /rest/v1/portal_budget_proposals` (line 4011) with a POST to `/rest/v1/rpc/portal_submit_budget_proposal` sending `{ p_portal_id, p_access_token: PORTAL_ACCESS_TOKEN, p_amount, p_note }` (map the existing amount/note vars). Keep the existing mailto fallback.

- [ ] **Step 5: Graceful no-token UX.** On a decision response that is non-2xx OR when `PORTAL_ACCESS_TOKEN` is null, show: "To sign or make selections, ask your contractor to re-send your portal link." (Reuse the existing error/alert path near each call; do NOT block page load — viewing must keep working.)

- [ ] **Step 6: Commit** — `git add marketing/portal/index.html && git commit -m "feat(portal): send accessToken on decision calls + graceful no-token UX"`

---

## Task 3: App — token in the share link

**Files:** Modify `utils/portalSnapshot.ts`, `app/client-portal-setup.tsx`

- [ ] **Step 1: `buildShortPortalUrl`** (`utils/portalSnapshot.ts` ~903): add an optional `accessToken?: string` param and append it. Handle the query join with the existing `inviteId`:
```typescript
export function buildShortPortalUrl(
  baseUrl: string, portalId: string, inviteId?: string, accessToken?: string,
): string {
  const base = `${baseUrl}/${portalId}`;
  const params = new URLSearchParams();
  if (inviteId) params.set('inviteId', inviteId);
  if (accessToken) params.set('t', accessToken);
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}
```

- [ ] **Step 2: Confirm the token is NEVER added to the snapshot.** Grep `utils/portalSnapshot.ts` for where `portalApi` / snapshot config is built; ensure `accessToken` is not included there. (It must travel only in the URL.) Add a one-line comment at the snapshot builder noting this.

- [ ] **Step 3: `client-portal-setup.tsx`** — pass `project?.clientPortal?.accessToken` into `buildShortPortalUrl` for `portalLink` (~line 282). If `accessToken` is falsy, set a `linkPending` flag.

- [ ] **Step 4: "Finalizing secure link" UX** — in the Copy/Share row (~671-680) and `handleCopyLink` (~445), when `linkPending` is true, disable Copy/Share and show "Finalizing secure link…" (the token is set server-side on the next sync). When present, normal copy.

- [ ] **Step 5: tsc gate** — `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit** — `git add utils/portalSnapshot.ts "app/client-portal-setup.tsx" && git commit -m "feat(portal): carry accessToken in share link; finalizing state"`

---

## Self-Review
1. **Spec coverage:** token backfill+trigger (T1) ✓; sign/selection/budget token-gated (T1) ✓; audit+throttle (T1) ✓; anon budget policy dropped (T1) ✓; portal HTML sends token + graceful UX (T2) ✓; link carries token, not snapshot (T3) ✓; reads unchanged ✓.
2. **Placeholders:** `<ts>` = real timestamp at create; budget columns verified in T1 Step 2 (not assumed at finalize). No vague items.
3. **Consistency:** RPC names + the new `p_access_token` param match across migration ↔ portal HTML body keys; `buildShortPortalUrl` 4th arg consistent T3↔callers.

## Deploy (CONFIRM-GATED — NOT OTA-only; do in this order)
1. **Apply the Supabase migration** to prod (explicit confirm — touches financial-decision security; reversible notes in header).
2. **Deploy `marketing/portal`** via build-free `netlify deploy --dir` (per the marketing deploy procedure; needs the user's PAT).
3. **App OTA** (production) for the link change.
Keep 1→2 close together to minimize the window where decisions are gated before the new portal HTML/links are live (intended security behavior).
