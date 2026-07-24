# Anon-read RLS sweep — 2026-07-21

**Method:** enumerated every `public` table where the `anon` role holds a SELECT
privilege (88 tables), then probed each with a **real unauthenticated REST call**
using the public anon key (`GET /rest/v1/<table>?select=*` with `Prefer: count=exact`).
Recorded only row counts / column shapes — never sensitive payloads. This is the
ground-truth test that reading `pg_policies` alone cannot give (see the portal
Part-A correction below).

## Result: no cross-tenant PII leak

All tenant-scoped tables — `projects`, `invoices`, `project_contracts`,
`daily_reports`, `photos`, `messages`, `profiles`, `subcontractors`, `estimates`,
safety/`jhas`/`hazards`, `punch_items`, `rfis`, `submittals`, `commitments`,
`change_orders`, `portal_messages`, `portal_snapshots`, `sub_portal_snapshots`, … —
returned **0 rows to anon**. RLS is holding across the board. Only 7 of 88 tables
returned any rows to an anonymous caller.

| Table | Anon rows | Verdict |
|---|---|---|
| `cached_companies` | 1933 | Intended-public — scraped Google-Places business directory (name/address/public phone/rating). No app-user PII. |
| `cached_bids` | 518 | Intended-public — government solicitation notices (SAM.gov-style); contact fields are public contracting-officer info. |
| `cached_jobs` | 483 | Intended-public — scraped public job-board listings. |
| `city_coords` | 1338 | Intended-public — geocode reference cache. Non-sensitive. |
| `geocode_run_lock` | 1 | Non-sensitive coordination lock row. |
| `app_config` | 3 | **Locked** — server-only config. Exposed 2 edge-fn URLs + an empty `notify_key`. No secret today, but shouldn't be world-readable. |
| `rate_limit_counters` | 12 | **Locked** — `scope` embeds magic-link requester **emails + IP addresses** + portal ids. Real (low/medium) unauthenticated PII-harvest. |

## Fixes applied (prod, 2026-07-21)

1. `20260721043510_portal_rls_drop_defanged_client_read_policies` — dropped the
   four `*_client_*` portal policies on `project_contracts` / `selection_categories`
   / `selection_options` / `closeout_binders` + revoked anon SELECT. These were a
   **defanged** footgun, not an active leak: their `EXISTS(projects … enabled)`
   subquery runs under anon's RLS on `projects`, and anon can't read `projects`, so
   an anon GET already returned `*/0`. Removed as defense-in-depth (a future
   anon-readable `projects` policy would otherwise turn them into real leaks). This
   corrects the severity claim in `2026-07-13-portal-rls-exposure.md`.

2. `20260721142607_lock_rate_limit_counters_and_app_config_reads` — dropped the
   `FOR SELECT using(true)` policies on `rate_limit_counters` + `app_config` and
   revoked anon/authenticated SELECT. Safe: rate-limiting uses the
   `rate_limit_increment` RPC and `notify` reads `app_config`, both via the
   **service_role** key (bypasses RLS). Post-fix anon read → HTTP 401. No client
   path reads either table.

## Verification

- Before: anon `GET /rate_limit_counters` returned 12 rows incl.
  `magiclink:email:…` / `magiclink:ip:<ipv4>` scopes.
- After: anon `GET /rate_limit_counters` and `/app_config` → **HTTP 401 permission denied**.
- No collateral: `cached_companies` / `cached_bids` still return rows to anon (206).
- Write side: all 7 anon-readable tables had a single `FOR SELECT` policy and **no
  write policy**, so anon INSERT/UPDATE/DELETE was already blocked by RLS despite the
  Supabase-default `GRANT ALL`. Not exploitable.

## Anon RPC-execute audit (SECURITY DEFINER functions)

Also enumerated every SECURITY DEFINER function in `public` that `anon` can EXECUTE
(43 of them), and live-probed the non-portal/non-trigger ones. Most are legitimate:
token-gated public flows (`portal_*`, `*_by_token`, `submit_pro_response`,
`fetch_shared_schedule` via an unguessable snapshot uuid), inert trigger bodies, and
low-sensitivity id resolvers (`gc_for_portal` → uuid). Two real issues — both the same
class as an over-privileged grant — were found and fixed:

- 🔴 **AI-usage RPCs** (`ai_usage_get/increment/summary`, `ai_daily_usage_get/increment`,
  `ai_usage_daily_get/increment`). Pinned `v_uid := COALESCE(auth.uid(), p_user_id)`,
  so an anon caller (null `auth.uid()`) has `p_user_id` honored. **Verified live:** anon
  `POST /rpc/ai_daily_usage_get` with an arbitrary `p_user_id` returned HTTP 200 → an
  unauthenticated attacker could exhaust any user's AI quota (`ai_usage_increment`, DoS)
  or read their usage. The 2026-07-14 `revoke_anon_ai_usage_rpcs` had run
  `REVOKE … FROM anon` while EXECUTE was still granted to **PUBLIC**, so anon kept
  access. Fixed by `20260721150148_revoke_public_execute_on_ai_usage_rpcs`
  (`REVOKE … FROM public`). Post-fix anon → HTTP 401. `authenticated` (pin-scoped) +
  `service_role` (the edge `ai` fn) retained.

- 🟠 **`rate_limit_increment`** — server-only counter bump (called only by edge
  functions via service_role) was anon-executable. An attacker could inflate
  `magiclink:email:<victim>` / `passcode:portal:<id>` counters to lock a user out of
  login or their portal. It had **explicit** `anon` + `authenticated` grants (so the
  first `REVOKE … FROM public`, `20260721150432`, was a no-op — a good reminder to check
  the ACL shape, not just `has_function_privilege`). Fixed by
  `20260721150543_revoke_anon_auth_execute_on_rate_limit_increment`. Post-fix anon → HTTP 401.

The two most critical SECURITY DEFINER functions from the 07-13 audit — `award_rfp`
(RFP-hijack) and `match_project_memory` — were re-verified: ACL is
`postgres | service_role` only (no anon/authenticated/PUBLIC). Correctly locked.

## Takeaway

Reading `pg_policies` over-claimed the portal Part-A severity (a policy that *looks*
like `using(portal enabled)` is gated by the referenced table's own RLS). And a
`REVOKE … FROM anon` is a silent no-op when the privilege is held via **PUBLIC** (or
was left when an explicit grant exists). Both traps produce a "fixed on paper, open in
prod" state. Always confirm with a real anon probe against production, and inspect the
actual `proacl` / `pg_policies`, not just the migration that claims the fix.
