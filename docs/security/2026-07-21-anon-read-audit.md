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

## Takeaway

Reading `pg_policies` over-claimed the portal Part-A severity (a policy that *looks*
like `using(portal enabled)` is gated by the referenced table's own RLS). Always
confirm with a real anon probe.
