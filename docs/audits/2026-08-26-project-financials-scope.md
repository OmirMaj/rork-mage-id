# project_financials split — scope & apply review

Written 2026-08-26, before applying anything to production. Numbers are from a
read-only query against the live DB (`nteoqhcswappxxjlpvap`), not estimates.

---

## Why

`projects` carries four financial jsonb columns — `estimate`, `linked_estimate`,
`estimate_versions`, `target_budget`. Field collaborators must be able to read
`projects.schedule`, and Postgres RLS is **row**-level: it cannot blind columns,
and column GRANTs apply per database role (every app user is `authenticated`).
So the only real fix is to stop keeping the money on a row field users may read.

---

## Blast radius — measured, not guessed

| Thing | Count |
|---|---|
| Projects total | **7** |
| Projects carrying money (backfill size) | **5** |
| …with `estimate` | 3 |
| …with `linked_estimate` | 3 |
| …with `estimate_versions` | 3 |
| …with `target_budget` | **0** |
| Project collaborators (any status) | **0** |
| Collaborators accepted | **0** |
| `project_financials` exists yet | **no** |

**Two things follow from this.**

1. **The migration is tiny.** Five rows to copy. It runs instantly and is
   trivially reversible — nothing is dropped in phase 1.
2. **The leak is currently theoretical.** There are zero collaborators, so no
   one but the owner can read any project row today. That lowers the urgency —
   and raises the argument for doing it *now*, while there are 5 rows to move
   and no users to disrupt. This gets strictly more expensive later.

---

## What is already built

| Piece | State |
|---|---|
| `20260826140000_project_financials_split.sql` (create, backfill, RLS) | written, **not applied** |
| `20260827120000_project_financials_drop_legacy.sql` (phase 2) | written, **not applied** |
| `contexts/ProjectContext.tsx` read path (new-first, legacy fallback) | done — 1 site |
| `contexts/ProjectContext.tsx` dual-writes | done — 2 sites |
| `test:project-financials-split` guard | done, negative-tested |

Access model on the new table: **SELECT = owner \| editor \| viewer**, write =
owner \| editor, delete = owner. `field` appears nowhere. `scope` deliberately
stays on `projects` — scope-of-work is operational and the crew needs it.

---

## The gap I found while scoping — ✅ NOW CLOSED (2026-08-26)

All four edge functions below were migrated the same day. Each now reads
`project_financials` with a legacy fallback, so they are correct **before and
after** either migration; `item.ts` additionally dual-writes. The QBO pair
shares one helper — `supabase/functions/_shared/qbo-mapping/financials.ts` — so
the read and the write cannot drift apart.

`test:project-financials-split` now asserts all four route through the new
table and **fails** if one regresses to a bare legacy read. Phase 2 is
unblocked. Original finding preserved below.

---

### (original finding)

The client is not the only consumer. **Four edge functions read the legacy
columns straight from PostgREST**, and one of them writes:

| File | What it does |
|---|---|
| `supabase/functions/construction-answer/index.ts` | selects `estimate,linked_estimate` |
| `supabase/functions/mcp/index.ts` | selects `estimate,linked_estimate` |
| `supabase/functions/_shared/qbo-mapping/invoice.ts` | selects `linked_estimate` |
| `supabase/functions/_shared/qbo-mapping/item.ts` | selects **and UPDATEs** `linked_estimate` |

Consequences:

- **Phase 2 would break all four.** Dropping the columns makes their selects
  return nothing; the AI answer path and the QBO sync would silently degrade.
- **`item.ts` is a write path the guard did not cover.** It stamps `qboItemId`
  back onto `projects.linked_estimate`. During the dual-write window that write
  lands on the legacy column only, so `project_financials.linked_estimate` goes
  stale for QBO item ids until the next client-side project save rewrites it.
  Low severity (it is an id backfill, not money), but it is real drift.

`test:project-financials-split` now prints this list on every run, so phase 2
cannot be applied blind.

---

## Sequence

    1. apply 20260826140000_project_financials_split.sql   ← safe now
    2. deploy the 4 edge functions                          ← DONE in code
    3. ship the OTA (client reads/writes the new table)
    4. open the app; confirm estimates + budgets still render
       …and if QBO is connected, run one invoice sync
    5. apply 20260827120000_..._drop_legacy.sql            ← leak closes here

Every step is now written and verified. 1–4 are safe and reversible; only step
5 is one-way, and it self-guards (`raise exception`) against dropping a column
that is still the only copy.

Deploy commands:

    supabase db push
    supabase functions deploy construction-answer
    supabase functions deploy mcp
    # invoice.ts / item.ts live in _shared and are bundled into their callers,
    # so both consumers must be redeployed to pick the change up:
    supabase functions deploy qbo-sync
    supabase functions deploy qbo-reconciler

---

## Risk & rollback

**Phase 1 risk: very low.** Purely additive — a new table, a backfill of 5
rows, a new function, four policies. Nothing on `projects` is altered or
dropped. Rollback is `drop table public.project_financials cascade;` plus
dropping `can_view_project_financials`; the legacy columns still hold every
value, so no data can be lost.

**If the OTA reaches a device before step 1:** the `project_financials` write is
queued, PostgREST returns a schema-cache miss, and `utils/offlineQueue`
classifies that as transient — the write is re-queued unchanged without burning
retry budget and self-heals once the table exists. Reads fall back to the legacy
columns. No data loss either way.

**Phase 2 risk: high until step 4 is done**, which is why it is gated. Its own
`raise exception` guard also refuses to drop anything if a project still holds
money with no `project_financials` row, and it tops up stragglers with
`coalesce` so a stale legacy value can never overwrite a newer one.

---

## Recommendation

Apply phase 1 and ship the OTA — cheap, safe, reversible, and it gets strictly
harder the longer real data accumulates. Hold phase 2 until the four edge
functions are migrated. That migration is a contained piece of work (four files,
same pattern each time) and is the natural next step.
