# Live Schedule Collaboration — Design Spec

**Date:** 2026-07-28
**Status:** Approved (design); ready for implementation planning (Phase 1 first)
**Author:** Claude + founder

## Goal

Let more than one person work on a project's schedule together on the **web app**:
invite a teammate, they sign in, and they can edit the same schedule — with changes
appearing **live** for everyone and **presence** showing who is editing what
(the "Figma / Google Docs" feel).

## Non-goals (explicitly out of scope for now)

- Invite-by-link / anonymous collaborators (accounts-only for v1; link-based can be added later).
- Per-field permissions (a collaborator sees the whole project row, including estimate/costs — acceptable for a trusted teammate).
- Offline concurrent editing convergence beyond last-write-wins-per-task (true CRDT is Phase 3, build-only-if-needed).
- Collaboration on anything other than the schedule in v1 (the access layer is general, but the live/presence work targets the schedule surfaces).

## Current-state context (verified against code + live prod DB)

These facts shape every decision below:

1. **Single-tenant.** `projects` RLS gates on `auth.uid() = user_id` for all of
   SELECT/INSERT/UPDATE/DELETE (`supabase/migrations/20260518120000_rls_baseline.sql:701-723`).
   No team/collaborator/org path exists. Two authenticated users cannot access one project today.
2. **Schedule = a JSONB blob** on `projects.schedule` (`supabase/schema.sql:60`). There is **no**
   `schedules`/`schedule_tasks` table. Two writers on one schedule = two writers on one JSONB cell
   (whole-row upsert, last-write-wins clobber). Persistence is a **debounced** `updateProject` →
   `supabaseWrite('projects','upsert', …)` through the offline queue (`app/schedule-pro.tsx:502-524`,
   `utils/offlineQueue.ts`). CPM recomputes synchronously client-side via `runCpm` in a `useMemo`
   (`app/schedule-pro.tsx:293-294`, `utils/cpm.ts:905`).
3. **Realtime exists but not on the schedule.** Supabase Realtime is used as `postgres_changes`
   (DB-change → refetch/merge) on chat, notifications, and the client portal
   (`contexts/HireContext.tsx:205-263`, `app/client-view.tsx:243-289`). The live publication is
   **10 tables** — `projects` is NOT among them, so there is no live signal for schedule changes
   today. **Zero** presence/broadcast/multiplayer anywhere (grep for `.on('presence'`, `.track(`,
   `broadcast`, `yjs`, `liveblocks` → nothing). *Config-drift note:* the prod publication has 5 more
   tables than the migration lists — realtime provisioning isn't fully captured in migrations.
4. **Closest existing "collaboration"** is the client portal: a token/passcode party (no full account)
   writes via hardened SECURITY-DEFINER RPCs with realtime refresh. The schedule's own share
   (`app/shared-schedule.tsx`) is **read-only** (edit handler is a no-op at `:396`).
5. **`ProjectCollaborator` type already exists** (`types/index.ts:83`): `role: 'owner'|'editor'|'viewer'`,
   `status: 'pending'|'accepted'`, `email`, `invitedAt`. Today it is only a display-only item in a
   `collaborators` JSONB array on the project — no auth behind it. A **draft** normalized table
   (`supabase/migrations/add_project_collaborators.sql`) exists but is **unapplied to prod and unreferenced**.
6. **Identity precedent:** `claim-crew` (edge fn + single-use `claim_token`, `app/claim-crew.tsx`)
   already does token-redeem → real auth user. The invite/accept flow reuses this pattern.
7. **Web Gantt already exists:** `app/schedule-pro.tsx` is the desktop/web editor (editable `GridPane`
   + drag `InteractiveGantt` via `react-native-svg` + PanResponder), gated at width ≥900, split
   grid+Gantt at ≥1600. This is the host surface for the collaborator UI.
8. **Personas correction:** the app's real `UserRole` is `contractor | client | both | property_manager`
   (`utils/onboardingProfile.ts:19`) — there is no "Scheduler" persona. Personas only gate tab-bar
   routing, not permissions.

## Architecture — three phases

Each phase produces working, shippable software. Build order: 1 → 2 → (3 only if needed).

---

### Phase 1 — Multi-user access (the foundation)

**1.1 Data model — apply `project_collaborators`**

A normalized table (supersedes the display-only JSONB array):

```
project_collaborators
  id            uuid pk default gen_random_uuid()
  project_id    uuid not null references projects(id) on delete cascade
  invited_email text not null                       -- lowercased
  user_id       uuid null references auth.users(id)  -- null until accepted
  role          text not null check (role in ('owner','editor','viewer'))
  status        text not null default 'pending'
                  check (status in ('pending','accepted','revoked'))
  invite_token  text unique                          -- single-use, cleared on accept
  invited_by    uuid not null references auth.users(id)
  invited_at    timestamptz not null default now()
  accepted_at   timestamptz
  unique (project_id, invited_email)
```

The project **owner** stays implicit (`projects.user_id`); rows in this table are the *other* people.

**1.2 RLS — the enforcement boundary**

Add a SQL helper so policies stay readable and non-recursive:

```sql
create or replace function public.is_project_collaborator(pid uuid, min_role text default 'viewer')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_collaborators pc
    where pc.project_id = pid
      and pc.user_id = auth.uid()
      and pc.status = 'accepted'
      and case min_role
            when 'editor' then pc.role in ('owner','editor')
            else true
          end
  );
$$;
```

Extend `projects` policies (keep the existing owner path, add the collaborator path):

- **SELECT:** `auth.uid() = user_id OR public.is_project_collaborator(id)`
- **UPDATE:** `auth.uid() = user_id OR public.is_project_collaborator(id, 'editor')`
- **INSERT/DELETE:** owner only (unchanged) — collaborators don't create/delete projects.

`project_collaborators` own RLS:
- Owner of the parent project (via a `projects` sub-select on `user_id`) can do everything.
- An invitee can `SELECT` and `UPDATE` (accept) **only their own row** (matched by `user_id` after redeem, or by `invited_email = auth.jwt()->>'email'` during accept).

> **Cross-table note:** because the schedule lives on `projects.schedule`, extending `projects` RLS
> is sufficient for the schedule. Related tables (change_orders, invoices, daily_reports, etc.) are
> **not** opened to collaborators in Phase 1 — the schedule feature only needs the project row.
> Revisit if collaborators later need those.

**1.3 Invite → accept flow (mirrors `claim-crew`)**

1. Owner (Collaborators UI) submits `email + role` → an edge function `project-invite`
   (SECURITY-DEFINER / service role) inserts a `pending` row with a generated single-use `invite_token`
   and sends an email via the existing Resend infra (`backend/hono.ts` `/email/send` or a dedicated
   edge fn) containing an accept link: `https://app.mageid.app/accept-invite?token=…`.
2. Invitee opens the link → `app/accept-invite.tsx`:
   - Not signed in → route through login/signup (existing auth), preserving `?token`.
   - Signed in → call edge fn `project-invite` (action `accept`) which validates the token
     (unexpired, matches the caller's email), sets `user_id = auth.uid()`, `status = 'accepted'`,
     `accepted_at = now()`, and **clears `invite_token`** (single-use).
3. Owner can `revoke` (status → 'revoked'; RLS immediately denies) or change a role.

**1.4 Roles + permissions**

- **owner** — full control incl. managing collaborators.
- **editor** — read + edit the schedule/project (RLS UPDATE allows).
- **viewer** — read-only (RLS UPDATE denies; client renders read-only UI).

Enforcement is **server-side via RLS** (source of truth); the client additionally *reflects* role
(hide edit affordances for viewers) for good UX. Never trust the client for permission.

**1.5 Client architecture**

- `contexts/ProjectCollaboratorsContext.tsx` (or extend `ProjectContext`): loads collaborators for a
  project, exposes `myRole(projectId)`, `invite`, `revoke`, `changeRole`. React-query backed;
  writes through the offline queue where possible (invites go through the edge fn).
- `hooks/useProjectRole.ts` → `'owner'|'editor'|'viewer'|null`. Schedule screens gate edit affordances
  on `role !== 'viewer'`.
- **UI:** upgrade the display-only Team list in `app/project-detail.tsx:1376` into a real
  **Collaborators manager** (invite by email + role picker, pending/accepted state, revoke, change role).
  New route `app/accept-invite.tsx` for the redeem flow.

**Phase 1 delivers:** "Invite your PM by email → they sign in → they can open and edit this project's
schedule; viewers can watch." Edits still save via the normal debounced whole-row upsert (simultaneous
edits can still clobber — solved in Phase 2 by presence + task-merge).

---

### Phase 2 — Live sync + presence (the "Figma feel")

**2.1 Live sync (no storage migration)**

- Add `projects` to the `supabase_realtime` publication (migration; also document the manual-dashboard
  drift so it's reproducible).
- On an open schedule, subscribe to that project row (`postgres_changes`, filter `id=eq.{projectId}`).
- On a peer change, **merge task-by-task** into the local schedule by task id — never a wholesale
  replace that would nuke the local user's in-flight edit — then re-run `runCpm`.
- Saves stay debounced but do a **merge-before-write**: re-read the latest `projects.schedule`, apply
  only this client's task deltas, write. Reduces (doesn't fully eliminate) clobber. Convergence rule:
  **last-write-wins per task**, made safe in practice by presence (2.2).

**2.2 Presence**

- Supabase Realtime **Presence** on a `schedule:{projectId}` channel. Each client `.track()`s
  `{ userId, name, color, selectedTaskId }`.
- UI on `schedule-pro`: collaborator **avatars** in the header; a **soft highlight / lock** on the task
  another user has selected or is dragging (so two people don't grab the same bar). Optional `broadcast`
  for live drag position (ephemeral, no persistence).
- Presence is what makes last-write-wins acceptable — it prevents same-task collisions socially.

**Phase 2 delivers:** changes appear live for everyone; you see who's here and which task they're on;
same-task collisions are prevented by presence. On mobile the owner sees a web collaborator's edits live.

---

### Phase 3 — Hardened convergence (build only if needed)

If real-world same-task collisions still prove painful after Phase 2, migrate the schedule from the
single JSONB blob to per-task rows:

```
schedule_tasks (project_id, task_id, …task fields…, updated_by, updated_at)
```

with row-level Realtime, so each task edit is an independent upsert that merges without touching other
tasks. This is the most invasive change — it touches all 6 schedule surfaces
(`schedule-pro`, `(tabs)/schedule`, `schedule-builder`, `schedule-wizard`, `schedule-review`,
`last-planner`), CPM's read path, portal snapshots, and the offline queue — so it is **deferred** and
gated on evidence that presence + task-merge weren't enough. Design it in its own cycle if triggered.

---

## Cross-cutting concerns

- **Platform:** collaborator *editing* UI is web-first (`schedule-pro`); live sync + presence reach
  **all** platforms (owner on mobile sees web edits live). No `.web.tsx` split — runtime `Platform.OS`.
- **CPM:** unchanged — re-runs client-side per client after applying peer changes.
- **Offline queue:** unchanged path; RLS UPDATE must allow editor collaborators (covered by 1.2).
- **Identity / "edited by":** presence provides the live actor. Optionally add `updated_by` to the
  save path for a persisted "last edited by" (nice-to-have, not required for v1).
- **Security:** RLS is the boundary; invite tokens are single-use + expiring; viewers physically
  cannot write; the invite/accept edge fn runs service-role and validates token↔email.
- **Billing/tier — DECIDED: inviting gates to Pro.** Add a `schedule_collaboration: 'pro'` key to
  `utils/featureTiers.ts` (FeatureKey union + REQUIRED_TIER). The Collaborators "Invite" action gates
  on `canAccess('schedule_collaboration')`; below Pro, route to `/paywall`. **Only creating invites is
  gated** — accepting an invite and viewing/editing as an already-accepted collaborator is NOT gated
  (an invited teammate can be on any tier, including free).

## Testing strategy

- **RLS unit/integration:** SQL tests (or `scripts/` validators) proving: an accepted editor can
  UPDATE a project they don't own; a viewer cannot; a revoked collaborator cannot; a non-collaborator
  cannot; the owner path is unchanged. This is the highest-risk surface — test it hardest.
- **Invite flow:** token single-use (second redeem fails), email-mismatch rejected, expired token rejected.
- **Merge logic (Phase 2):** unit-test the task-level merge (peer changes task A, I'm editing task B →
  both survive; peer + I both change task A → last-write-wins, no crash) with a pure function.
- **Presence (Phase 2):** manual multi-window web test + a smoke test that two clients see each other.
- **Ship-check** (`bun run ship-check`) must stay green throughout; native + web smoke on the simulator.

## Risks / open questions

- **RLS recursion/perf:** the `is_project_collaborator` helper must be `stable`/`security definer` and
  avoid policy recursion; watch query plans on hot paths (schedule loads).
- **Realtime on `projects`:** enabling it publishes ALL project-row changes to subscribers — confirm no
  sensitive fields leak to a collaborator who shouldn't see them (they get the whole row by design in v1).
- **Clobber window (Phase 1 before Phase 2):** simultaneous edits can lose data until presence lands —
  acceptable for a small team short-term; flag it in the Collaborators UI ("live editing coming soon").
- **Tier gating:** RESOLVED — inviting requires Pro (`schedule_collaboration: 'pro'`); accepting/editing
  as an already-invited collaborator is not gated.
- **Config drift:** realtime publication changes must go in a migration, not just the dashboard.

## Decomposition note

This is **multi-spec**. Phase 1 (multi-user access) is the first independently-buildable, independently-
valuable unit and should get its own implementation plan first. Phases 2 and 3 each get their own
spec → plan → build cycle. This document is the shared design of record for all three.
