# Live Schedule Collaboration — Phase 1 (Multi-User Access) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project owner invite a teammate by email who signs in and gets role-based (owner/editor/viewer) access to that project's schedule, enforced by Supabase RLS.

**Architecture:** A new `project_collaborators` table + a SECURITY-DEFINER RLS helper extend `projects` row access from single-owner to "owner OR accepted collaborator (editor for writes)". A service-role edge function `project-invite` handles invite/accept(token single-use)/revoke/change-role and sends the invite email. The client gets a collaborators data layer (`ProjectCollaboratorsContext` + `useProjectRole`), a Collaborators manager UI, an `accept-invite` route, and role-gated edit affordances on `schedule-pro`. Inviting is gated to Pro.

**Tech Stack:** Supabase (Postgres RLS, Deno edge functions, Realtime later), Expo Router, React Native (Web), `@tanstack/react-query`, `@nkzw/create-context-hook`, the offline queue (`utils/offlineQueue.ts`), RevenueCat tiers (`useTierAccess`).

**Reference files to read before starting:**
- Design spec: `docs/superpowers/specs/2026-07-28-live-schedule-collaboration-design.md`
- Existing single-owner RLS: `supabase/migrations/20260518120000_rls_baseline.sql:701-723`
- Draft (unapplied) table to adapt: `supabase/migrations/add_project_collaborators.sql`
- Edge-fn boilerplate + single-use token pattern to mirror: `supabase/functions/claim-crew/index.ts` (CORS, service-role client, token redeem, freeze trigger)
- Ownership-check + JWT-decode pattern: `supabase/functions/create-payment-link/index.ts:246-330`
- Existing type: `types/index.ts:83` (`ProjectCollaborator`)
- Tier gate pattern: `utils/featureTiers.ts`, `hooks/useTierAccess.ts` (see the `portfolio_margin` key added 2026-07-28 as a worked example)
- Display-only Team list to replace: `app/project-detail.tsx:~1376`
- Web schedule editor to role-gate: `app/schedule-pro.tsx`

---

## File Structure

**Create:**
- `supabase/migrations/20260728140000_project_collaborators.sql` — table + `is_project_collaborator()` helper + extended `projects` RLS + `project_collaborators` RLS.
- `supabase/tests/collaborator_rls_test.sql` — RLS assertions via jwt-claim simulation (run in CI / manually via `execute_sql`).
- `supabase/functions/project-invite/index.ts` — invite / accept / revoke / change-role edge function.
- `contexts/ProjectCollaboratorsContext.tsx` — load + mutate collaborators for a project.
- `hooks/useProjectRole.ts` — the current user's role on a project.
- `components/collaborators/CollaboratorsManager.tsx` — invite + manage UI.
- `app/accept-invite.tsx` — invite-redeem route.
- `scripts/validate-collaborator-invite.ts` — pure invite/token/role-logic tests.

**Modify:**
- `types/index.ts` — extend `ProjectCollaborator` with the DB-backed fields.
- `utils/featureTiers.ts` — add `schedule_collaboration: 'pro'`.
- `app/_layout.tsx` — register `accept-invite` screen + mount `ProjectCollaboratorsProvider`.
- `app/project-detail.tsx` — replace the display-only Team list with `<CollaboratorsManager/>`.
- `app/schedule-pro.tsx` — gate edit affordances on `useProjectRole` (viewer = read-only).
- `package.json` — add the new validator to the `ship-check` script chain.

---

## Task 1: `project_collaborators` table + RLS

**Files:**
- Create: `supabase/migrations/20260728140000_project_collaborators.sql`
- Test: `supabase/tests/collaborator_rls_test.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Multi-user project access (Live Schedule Collaboration Phase 1).
-- Extends single-owner projects to "owner OR accepted collaborator".
create table if not exists public.project_collaborators (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  invited_email text not null,
  user_id       uuid references auth.users(id),
  role          text not null check (role in ('owner','editor','viewer')),
  status        text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invite_token  text unique,
  invited_by    uuid not null references auth.users(id),
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  unique (project_id, invited_email)
);
create index if not exists idx_project_collaborators_project on public.project_collaborators(project_id);
create index if not exists idx_project_collaborators_user    on public.project_collaborators(user_id);

alter table public.project_collaborators enable row level security;

-- Non-recursive membership check used by projects policies.
create or replace function public.is_project_collaborator(pid uuid, min_role text default 'viewer')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_collaborators pc
    where pc.project_id = pid
      and pc.user_id = auth.uid()
      and pc.status = 'accepted'
      and case min_role when 'editor' then pc.role in ('owner','editor') else true end
  );
$$;

-- projects: keep owner path, add collaborator path. Drop+recreate the owner policies.
drop policy if exists projects_select on public.projects;
drop policy if exists projects_select_own on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_update_own on public.projects;

create policy projects_select on public.projects for select to authenticated
  using (auth.uid() = user_id or public.is_project_collaborator(id));
create policy projects_update on public.projects for update to authenticated
  using (auth.uid() = user_id or public.is_project_collaborator(id, 'editor'))
  with check (auth.uid() = user_id or public.is_project_collaborator(id, 'editor'));
-- INSERT/DELETE remain owner-only; if the baseline dropped them, recreate owner-only here.

-- project_collaborators RLS: owner of the parent project manages; invitee sees/uses only their own.
create policy pc_owner_all on public.project_collaborators for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy pc_invitee_read on public.project_collaborators for select to authenticated
  using (user_id = auth.uid() or lower(invited_email) = lower(auth.jwt()->>'email'));
```

> **NOTE for the implementer:** first `SELECT policyname FROM pg_policies WHERE tablename='projects'` against prod (via Supabase MCP `execute_sql`) to get the ACTUAL current policy names — the baseline created both `projects_select` and `projects_select_own` variants (`rls_baseline.sql:701-723`); drop whatever exists before recreating. Do NOT assume names.

- [ ] **Step 2: Apply to a Supabase branch (not prod) and verify structure**

Use Supabase MCP `create_branch` → `apply_migration` on the branch, then:
Run (via `execute_sql` on the branch): `select count(*) from information_schema.columns where table_name='project_collaborators';`
Expected: 10 columns; `is_project_collaborator` function exists; policies present.

- [ ] **Step 3: Write the RLS test (jwt-claim simulation)**

`supabase/tests/collaborator_rls_test.sql` — seed one owner, one project, one collaborator; simulate each user via `set local request.jwt.claims` and assert visibility/writability:

```sql
begin;
-- seed (use fixed uuids)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','owner@test'),
  ('00000000-0000-0000-0000-0000000000e1','editor@test'),
  ('00000000-0000-0000-0000-0000000000v1','viewer@test'),
  ('00000000-0000-0000-0000-0000000000x1','outsider@test') on conflict do nothing;
insert into public.projects (id, user_id, name) values ('00000000-0000-0000-0000-0000000000p1','00000000-0000-0000-0000-0000000000a1','P') on conflict do nothing;
insert into public.project_collaborators (project_id, invited_email, user_id, role, status, invited_by)
  values ('...p1','editor@test','...e1','editor','accepted','...a1'),
         ('...p1','viewer@test','...v1','viewer','accepted','...a1');

-- editor can SELECT and UPDATE
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","email":"editor@test"}';
do $$ begin assert (select count(*) from projects where id='...p1')=1, 'editor cannot see'; end $$;
update projects set name='P2' where id='...p1';  -- must succeed (0 error)

-- viewer can SELECT, cannot UPDATE
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000v1","email":"viewer@test"}';
do $$ begin assert (select count(*) from projects where id='...p1')=1, 'viewer cannot see'; end $$;
do $$ begin
  begin update projects set name='NO' where id='...p1'; assert false, 'viewer WROTE'; exception when others then null; end;
end $$;
-- (RLS UPDATE denial surfaces as 0 rows affected, not an error; assert row unchanged instead:)
update projects set name='NO' where id='...p1';
do $$ begin assert (select name from projects where id='...p1') <> 'NO', 'viewer changed row'; end $$;

-- outsider sees nothing
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000x1","email":"outsider@test"}';
do $$ begin assert (select count(*) from projects where id='...p1')=0, 'outsider saw project'; end $$;
rollback;
```

- [ ] **Step 4: Run the RLS test on the branch**

Run via Supabase MCP `execute_sql` (branch). Expected: completes with no `assert` failure. Fix policy logic until green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728140000_project_collaborators.sql supabase/tests/collaborator_rls_test.sql
git commit -m "feat(collab): project_collaborators table + collaborator RLS on projects"
```

> **Do NOT apply to prod yet.** Prod apply happens in Task 8 after the full flow is verified on the branch.

---

## Task 2: Tier key `schedule_collaboration`

**Files:**
- Modify: `utils/featureTiers.ts` (FeatureKey union + REQUIRED_TIER map)
- Test: `scripts/validate-collaborator-invite.ts` (asserts the key resolves to 'pro')

- [ ] **Step 1: Add the key to the union and the map**

In `utils/featureTiers.ts`, add `| 'schedule_collaboration'` to the `FeatureKey` union (near the Pro+ keys) and `schedule_collaboration: 'pro',` to `REQUIRED_TIER` (in the Pro+ block). Mirror exactly how `portfolio_margin` was added (search the file for it).

- [ ] **Step 2: Assert it in the validator (write test first is trivial here; add to the invite validator in Task 5)**

Add to `scripts/validate-collaborator-invite.ts`: `expect('collab gates to pro', REQUIRED_TIER['schedule_collaboration'], 'pro')`.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → Expected: clean (the `Record<FeatureKey,...>` forces the map to stay exhaustive).

```bash
git add utils/featureTiers.ts
git commit -m "feat(collab): add schedule_collaboration Pro tier key"
```

---

## Task 3: `project-invite` edge function

**Files:**
- Create: `supabase/functions/project-invite/index.ts`

Actions (JSON body `{ action, ... }`), all requiring a valid caller JWT (decode `sub`/`email` like `create-payment-link/index.ts:260-274`):
- `invite { projectId, email, role }` — caller must OWN the project (service-role check `projects.user_id === caller.sub`). Insert a `pending` row with a generated `invite_token` (use `crypto.randomUUID()` twice or `crypto.getRandomValues`); send email via the existing Resend path (POST to the `email/send` route / mirror how `utils/emailService.ts` builds mail) with link `https://app.mageid.app/accept-invite?token=<token>`. Reject if caller isn't owner (403).
- `accept { token }` — look up the row by `invite_token` (unexpired, `status='pending'`); require `lower(row.invited_email) === lower(caller.email)`; set `user_id = caller.sub`, `status='accepted'`, `accepted_at=now()`, `invite_token=null` (single-use). Return `{ projectId }`.
- `revoke { collaboratorId }` — caller owns project → `status='revoked'`.
- `changeRole { collaboratorId, role }` — caller owns project → update `role`.

- [ ] **Step 1: Write the function** (mirror `claim-crew/index.ts` CORS + service-role client + `create-payment-link` JWT decode + ownership check). Deploy with `verify_jwt` per the caller-JWT model (the fn decodes the JWT itself; deploy default `verify_jwt=true` so the platform validates the session first).

- [ ] **Step 2: Deploy to the branch + smoke test**

Deploy via `supabase functions deploy project-invite --project-ref <branch-ref>`.
Run: `curl -s -X POST <branch-url>/functions/v1/project-invite -H "Authorization: Bearer <anon>" -H "apikey: <anon>" -d '{}'`
Expected: clean 400/401 (e.g. `{"error":"Missing action"}` or `Unauthenticated`), proving it loads.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/project-invite/index.ts
git commit -m "feat(collab): project-invite edge function (invite/accept/revoke/change-role)"
```

---

## Task 4: Client types + collaborators data layer

**Files:**
- Modify: `types/index.ts` (extend `ProjectCollaborator`)
- Create: `contexts/ProjectCollaboratorsContext.tsx`, `hooks/useProjectRole.ts`

- [ ] **Step 1: Extend the type**

In `types/index.ts` (`ProjectCollaborator` at :83), ensure fields: `id`, `projectId`, `invitedEmail`, `userId?: string | null`, `role: 'owner'|'editor'|'viewer'`, `status: 'pending'|'accepted'|'revoked'`, `invitedAt`, `acceptedAt?: string | null`. (Keep back-compat with the existing display-only usage.)

- [ ] **Step 2: Write the context**

`ProjectCollaboratorsContext.tsx` (via `@nkzw/create-context-hook`): a react-query query keyed on `['project_collaborators', projectId]` selecting from `project_collaborators` (RLS scopes it); mutations `invite/revoke/changeRole` call `supabase.functions.invoke('project-invite', { body })` then invalidate. Expose `collaborators`, `invite`, `revoke`, `changeRole`, `isLoading`.

- [ ] **Step 3: Write `useProjectRole`**

Returns `'owner' | 'editor' | 'viewer' | null` for `(projectId)`: `owner` if `project.user_id === auth user id`; else the accepted collaborator row's role; else `null`. Pure derivation from the collaborators query + auth.

- [ ] **Step 4: Test the role derivation**

Add a pure `roleForUser(project, collaborators, uid)` helper and unit-test it in `scripts/validate-collaborator-invite.ts` (owner → owner; accepted editor → editor; pending → null; revoked → null; outsider → null).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add types/index.ts contexts/ProjectCollaboratorsContext.tsx hooks/useProjectRole.ts scripts/validate-collaborator-invite.ts
git commit -m "feat(collab): collaborators data layer + useProjectRole"
```

---

## Task 5: `accept-invite` route

**Files:**
- Create: `app/accept-invite.tsx`
- Modify: `app/_layout.tsx` (register the screen)

- [ ] **Step 1:** Build the screen: read `?token`; if not authenticated, route to login/signup preserving the token; if authenticated, call `project-invite` `accept`, then on success `router.replace('/project-detail?id=<projectId>')` and show a success toast; on failure (bad/expired/email-mismatch token) show a clear error.
- [ ] **Step 2:** Register `<Stack.Screen name="accept-invite" />` in `app/_layout.tsx`. Ensure it is NOT behind the auth gate in a way that drops the token (preserve `?token` across the login round-trip).
- [ ] **Step 3: Manual verify on the branch** (see Task 8) — a second test user accepts and lands in the project.
- [ ] **Step 4: Commit** `feat(collab): accept-invite redeem route`.

---

## Task 6: Collaborators manager UI

**Files:**
- Create: `components/collaborators/CollaboratorsManager.tsx`
- Modify: `app/project-detail.tsx` (replace the display-only Team list ~:1376)

- [ ] **Step 1:** Build `CollaboratorsManager`: list current collaborators (avatar/email/role/status), an "Invite" form (email + role picker), revoke + change-role controls. Gate the **Invite** action on `useTierAccess().canAccess('schedule_collaboration')`; if not allowed, the Invite button routes to `/paywall`. Owner-only controls hidden for non-owners (`useProjectRole`).
- [ ] **Step 2:** Replace the existing display-only team block in `project-detail.tsx` with `<CollaboratorsManager projectId={project.id} />`. Keep the surrounding modal/tile pattern.
- [ ] **Step 3:** Follow app design tokens (`Type`, `Tokens`, theme colors, `MageAIMark` not needed here); no purple/emoji-as-icons (app-slop validator).
- [ ] **Step 4: Commit** `feat(collab): collaborators manager UI + Pro gate on invite`.

---

## Task 7: Role-gate the schedule editor

**Files:**
- Modify: `app/schedule-pro.tsx` (and, minimally, `app/(tabs)/schedule/index.tsx` if it's the classic fallback editor)

- [ ] **Step 1:** Call `useProjectRole(projectId)`; compute `canEdit = role === 'owner' || role === 'editor'`. When `!canEdit`, render the Gantt/grid read-only: disable drag on `InteractiveGantt`, disable `GridPane` cell editing, hide add/delete-task controls, and short-circuit the debounced `updateProject` save. (Server RLS already denies viewer writes; this is UX so a viewer isn't offered dead affordances.)
- [ ] **Step 2: Manual verify** (Task 8): viewer sees the schedule but cannot drag/edit; editor can.
- [ ] **Step 3: Commit** `feat(collab): read-only schedule for viewer role`.

---

## Task 8: Integrate, verify end-to-end on a branch, ship

**Files:** Modify `package.json` (ship-check chain), then prod apply.

- [ ] **Step 1:** Add `bun run scripts/validate-collaborator-invite.ts` to the `ship-check` script in `package.json`.
- [ ] **Step 2:** Run `bun run ship-check` → Expected: green (tsc + lint + all validators incl. the new one).
- [ ] **Step 3: End-to-end on the Supabase branch** (two real test accounts): owner (Pro) invites editor → editor accepts via link → editor edits a task on web `schedule-pro` → owner sees it after refresh (Phase 1 has no realtime yet) → viewer invited → viewer cannot edit. Verify the RLS test (Task 1) is green on the branch.
- [ ] **Step 4: Native + web smoke** on the simulator: the Collaborators UI renders; the invite Pro-gate routes free users to `/paywall`.
- [ ] **Step 5: Ship (with founder go-ahead):** apply the migration to prod (`apply_migration`), deploy `project-invite` to prod, then `eas update --branch production` for the client. Merge the branch back or discard per workflow.
- [ ] **Step 6: Commit** any remaining wiring: `chore(collab): wire ship-check + finalize Phase 1`.

---

## Self-Review

**Spec coverage:**
- Data model (spec 1.1) → Task 1 ✓
- RLS (spec 1.2) → Task 1 (+ hardest-tested per spec's testing section) ✓
- Invite/accept flow (spec 1.3) → Tasks 3, 5 ✓
- Roles + permissions (spec 1.4) → Tasks 1 (RLS), 4 (useProjectRole), 7 (UI gating) ✓
- Client architecture (spec 1.5) → Tasks 4, 6 ✓
- Tier gate to Pro (spec cross-cutting, DECIDED) → Tasks 2, 6 ✓
- Testing (RLS hardest, invite token, role derivation) → Tasks 1, 3, 4 ✓
- Phase 2/3 → explicitly out of scope for this plan (separate cycles) ✓

**Placeholder scan:** No "TBD"/"add error handling" left; the one deliberate implementer-judgment call (exact existing policy names to drop) is flagged with the precise query to run, not left vague.

**Type consistency:** `role`/`status` string unions identical across Task 1 (SQL check), Task 4 (TS type), Task 7 (`canEdit`). `is_project_collaborator(pid, min_role)` signature used consistently in Task 1 policies. `project-invite` action names (`invite/accept/revoke/changeRole`) consistent across Tasks 3, 4, 5, 6.

**Risk callout preserved:** Phase-1 simultaneous-edit clobber (pre-Phase-2) — surfaced in the Collaborators UI copy (Task 6) per the spec.
