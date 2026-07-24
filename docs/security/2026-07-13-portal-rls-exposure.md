# SECURITY ADVISORY — Client-portal cross-tenant data exposure (P0)

**Found:** 2026-07-13, during the full-app audit, by reading `pg_policies` directly.

---

## ✅ RESOLVED — status as of 2026-07-21 (corrected)

Both parts are now closed, and one severity claim below was **corrected by live testing**:

- **Part B (`portal_snapshots` / `sub_portal_snapshots`, `anon SELECT using(true)`) — the
  genuinely dumpable leak — was fixed 2026-07-14** (migrations `portal_token_rpcs` +
  `portal_lock_direct_access`): anon SELECT revoked, reads moved behind the
  token-gated `portal_get_snapshot` SECURITY DEFINER RPC. Verified live.

- **Part A (`project_contracts` / `selection_categories` / `selection_options` /
  `closeout_binders`) was NOT actually anon-exploitable.** The section below claimed an
  unfiltered anon GET "returns all rows for all tenants" — that is **wrong for these four
  tables**. Their policy `USING (EXISTS (SELECT 1 FROM projects p WHERE … enabled))`
  subquery runs under the **caller's** RLS on `projects`, and **anon cannot read
  `projects`**, so the `EXISTS` is always false. Verified 2026-07-21 with a real
  unauthenticated REST call: `GET /project_contracts?select=id` (and the other three)
  returned `content-range */0` — **zero rows**. The real security boundary is `projects`
  RLS, and it was holding. The lesson: reading `pg_policies` alone over-claimed; an
  actual anon probe is the ground truth.

- Part A's four `*_client_*` policies + anon table SELECT were nonetheless **dropped
  2026-07-21** (migration `20260721043510_portal_rls_drop_defanged_client_read_policies`)
  as **defense-in-depth** — they were a latent footgun (a future anon-readable `projects`
  policy would silently turn them into real contract/signature/IP leaks). Post-fix, an
  anon REST read of all four returns HTTP 401 "permission denied". GC owner access is
  preserved via the untouched `*_gc_*` policies.

The original advisory is retained below for the historical record; treat the
"returns all rows" framing for Part A as corrected above.

---

## What's exposed

The client portal is a static page (`marketing/portal/index.html`) that talks to
Supabase with the **public anon key**. RLS is therefore the *only* security boundary.
Several portal tables trust the caller far too much:

| Table | Policy | Effect |
|---|---|---|
| `portal_snapshots` | `anon SELECT using (true)` | Any anon request can dump **every** project's portal snapshot (homeowner name, schedule, progress, budget if open-book). |
| `sub_portal_snapshots` | `anon SELECT using (true)` | Same, for the subcontractor portal. |
| `project_contracts` | `SELECT to public using (client_portal.enabled)` | Any anon request can read **every portal-enabled project's** contract value, scope, terms, **signature paths, and captured IP addresses**. |
| `selection_categories` / `selection_options` | `SELECT to public using (client_portal.enabled)` | Anon can read every tenant's selections/allowances. |
| `closeout_binders` | `SELECT to public using (client_portal.enabled)` | Anon can read every tenant's closeout binder. |

Because RLS is evaluated per-row and PostgREST ignores no filter, `using (true)` /
`using (portal enabled)` means an unfiltered `GET /rest/v1/portal_snapshots?select=*`
(or `/project_contracts`) returns **all rows for all tenants**. The `portal_id` in the
share URL provides no protection: it is generated as
`portal-${projectId.slice(0,8)}-${Date.now().toString(36)}`
(`app/client-portal-setup.tsx:226`) — a truncated project id plus a timestamp, i.e.
**guessable**, and irrelevant anyway since the table can be dumped without any filter.

## The asset that SHOULD gate reads

Every portal already has a strong secret: `projects.client_portal->>'accessToken'` =
`encode(gen_random_bytes(24),'hex')` (192-bit), set by the `portal_set_access_token`
trigger and carried in the share URL as `?t=<token>`. The **write** paths already gate
on it — `portal_sign_contract` / `portal_choose_selection` require `p_access_token`.
Only the **read** paths were never tightened.

## Recommended fix (two parts)

### Part A — SAFE, portal does NOT read these tables directly (ready to apply)
`project_contracts`, `selection_*`, and `closeout_binders` are read by the portal
**only through the denormalized `portal_snapshots` blob** — never via a direct REST
select (verified: no such select in `marketing/portal/index.html`; the signing path is
a SECURITY DEFINER RPC that bypasses RLS). So their public read policies are unused by
the portal and can be dropped with **zero portal impact**:

```sql
-- Remove anon/public direct reads of contracts, selections, closeout binders.
-- The portal gets this data from portal_snapshots; GCs keep their owner policies.
drop policy if exists contracts_client_select on public.project_contracts;
drop policy if exists selcat_client_select    on public.selection_categories;
drop policy if exists selopt_client_select    on public.selection_options;
drop policy if exists cb_client_read          on public.closeout_binders;
```

### Part B — needs a coordinated portal change (design; do NOT apply alone)
`portal_snapshots` / `sub_portal_snapshots` / `portal_messages` ARE read directly by the
portal, so they can't just be locked without also teaching the portal to present the
token. Two options:

1. **RPC (preferred).** Add `portal_get_snapshot(p_portal_id text, p_access_token text)`
   and `portal_get_messages(...)` as SECURITY DEFINER functions that validate the token
   against `projects.client_portal->>'accessToken'` and return only that portal's rows;
   then `revoke select ... from anon` on the tables. Change the portal's fetches
   (`index.html` ~5532 for the snapshot, ~4393 for messages) from REST selects to
   `POST /rpc/...`. Cleanest, and matches the existing write-RPC pattern.
2. **Header-gated RLS.** Denormalize `access_token` onto the snapshot/message rows and
   rewrite the anon policy to
   `using (access_token = current_setting('request.headers',true)::json->>'x-portal-token')`,
   then have the portal send an `x-portal-token` header. Smaller portal diff, but leaks
   the token into request headers/logs and is easier to get subtly wrong.

Also fixes a **functional** bug in the same area: `portal_messages` has an anon INSERT
policy but **no anon SELECT** policy, so the homeowner can post messages but never sees
the GC's replies (the thread reads back empty). Whichever read model is chosen for
snapshots must also cover message reads, scoped to the caller's portal.

## Why this was NOT auto-applied

Part B changes RLS on **live production infrastructure that real homeowners are using
mid-project**, and requires the portal HTML to change in lockstep — apply the RLS
without the portal change and every live portal breaks; get the policy subtly wrong and
either the portal breaks or the hole stays open. That is exactly the
irreversible/shared-infra boundary that needs explicit owner sign-off and a tested,
coordinated apply + `netlify` portal deploy. Part A is safe in isolation but is still a
prod RLS change, so it is staged here for the owner to apply deliberately rather than
overnight-autonomously.

## Suggested apply order
1. Apply **Part A** now (safe; closes the worst leak — contracts + signatures).
2. Build **Part B** (RPC option), deploy the portal HTML change, then apply the
   revoke-anon migration in the same window; verify a real share link still loads.
