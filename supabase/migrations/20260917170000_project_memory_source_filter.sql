-- Project Memory / Ask Your Plans — scoped retrieval + an index that can be
-- diffed and pruned. Audit round 2, findings #19 and #23.
--
-- WHY (#19). Plan sheets and project records share ONE pool per (user,
-- project): every daily report, RFI, CO, submittal, punch item, Home Passport
-- doc AND every transcribed plan sheet. askPlans asked for the 8 nearest and
-- then threw away everything that was not a 'Plan Sheet', so on a job with a
-- year of daily reports the plan question got "(no matching plan sheets
-- found)" while the answer sat at rank 9. The source filter has to run INSIDE
-- the top-K, which only the database can do.
--
-- WHY (#23). project-memory-embed only ever upserted. The client sent the first
-- 250 records in a fixed order, so once RFIs + daily reports passed 250 every
-- later submittal and punch item was never embedded, an early submittal kept
-- the text it had on the day it was embedded (the "Revise and resubmit" note,
-- not the later "Approved as noted"), and a deleted RFI stayed citable
-- forever. The fix is a diffable index: each row carries the hash of the text
-- it was embedded from, the function can read (doc_id, hash) for a scope, and
-- it can delete doc_ids that no longer exist.
--
-- COMPATIBILITY. The 4-argument match_project_memory stays exactly as it is:
-- portal-ask-home and the currently-deployed project-memory-search call it, and
-- they keep working until they are redeployed. The new overload takes a fifth,
-- REQUIRED argument (no default), so a 4-argument call can never become
-- ambiguous between the two.
--
-- GRANTS. Service role only, like the 20260713140000 hardening of the original:
-- each of these is SECURITY DEFINER over a caller-supplied p_user_id, so a
-- direct grant to anon/authenticated would be a cross-tenant read (or, for the
-- delete, a cross-tenant wipe). The edge functions pass the VERIFIED user id.

-- ── 1. content_hash ─────────────────────────────────────────────────────────
-- Nullable: every row embedded before this migration has none, which the
-- function treats as "stale" — so the first sync after deploy re-embeds each
-- record once and the index converges on current text.
alter table public.memory_embeddings add column if not exists content_hash text;

-- ── 2. match_project_memory with a source filter ───────────────────────────
create or replace function public.match_project_memory(
  p_user_id uuid,
  p_project_id text,
  p_query text,
  p_match_count int,
  p_sources text[]
) returns table (doc_id text, source text, ref text, content text, similarity float)
language sql stable security definer set search_path = public
as $$
  select e.doc_id, e.source, e.ref, e.content,
         1 - (e.embedding <=> (p_query)::vector) as similarity
  from public.memory_embeddings e
  where e.user_id = p_user_id
    and e.project_id = p_project_id
    -- NULL or empty = no filter (same rows as the 4-argument form).
    and (coalesce(cardinality(p_sources), 0) = 0 or e.source = any (p_sources))
  order by e.embedding <=> (p_query)::vector
  limit greatest(1, least(coalesce(p_match_count, 8), 24));
$$;

comment on function public.match_project_memory(uuid, text, text, int, text[]) is
  'Cosine top-K over a project''s memory embeddings, scoped to one user and (optionally) to a set of sources, filtered BEFORE the limit.';

-- ── 3. Index state for a scope ─────────────────────────────────────────────
-- (doc_id, content_hash) for the rows whose doc_id starts with one of the
-- caller's prefixes. Prefix, not source: the prefix is what the CLIENT owns
-- (Project Memory writes rfi-/dfr-/co-/sub-/punch-, Ask Your Plans writes
-- plan-sheet:, the closeout binder writes the passport ids), so one surface's
-- sync can never see — or prune — another surface's rows. starts_with, not
-- LIKE: a doc id may legitimately contain '_' or '%'.
create or replace function public.project_memory_index_state(
  p_user_id uuid,
  p_project_id text,
  p_prefixes text[]
) returns table (doc_id text, content_hash text)
language sql stable security definer set search_path = public
as $$
  select e.doc_id, e.content_hash
  from public.memory_embeddings e
  where e.user_id = p_user_id
    and e.project_id = p_project_id
    and coalesce(cardinality(p_prefixes), 0) > 0
    and exists (select 1 from unnest(p_prefixes) p where length(p) > 0 and starts_with(e.doc_id, p));
$$;

comment on function public.project_memory_index_state(uuid, text, text[]) is
  'Which docs a (user, project) index holds under the given doc_id prefixes, with the hash each was embedded from. Empty prefix list returns nothing — a sync must name its scope.';

-- ── 4. Delete named docs ────────────────────────────────────────────────────
-- An array argument instead of a PostgREST `doc_id=in.(...)` filter: doc ids
-- are client-written strings, and splicing them into a URL filter is the
-- unescaped-`.in()` class the 2026-09-03 audit already found once. Scoped to
-- (user, project) so a doc id from another project cannot be named in.
create or replace function public.delete_project_memory_docs(
  p_user_id uuid,
  p_project_id text,
  p_doc_ids text[]
) returns int
language sql volatile security definer set search_path = public
as $$
  with gone as (
    delete from public.memory_embeddings e
     where e.user_id = p_user_id
       and e.project_id = p_project_id
       and e.doc_id = any (coalesce(p_doc_ids, '{}'::text[]))
    returning 1
  )
  select count(*)::int from gone;
$$;

comment on function public.delete_project_memory_docs(uuid, text, text[]) is
  'Remove index rows for records that no longer exist (deleted RFI, superseded plan sheet). Service role only.';

-- ── 5. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.match_project_memory(uuid, text, text, int, text[]) from public;
revoke all on function public.match_project_memory(uuid, text, text, int, text[]) from anon;
revoke all on function public.match_project_memory(uuid, text, text, int, text[]) from authenticated;
grant execute on function public.match_project_memory(uuid, text, text, int, text[]) to service_role;

revoke all on function public.project_memory_index_state(uuid, text, text[]) from public;
revoke all on function public.project_memory_index_state(uuid, text, text[]) from anon;
revoke all on function public.project_memory_index_state(uuid, text, text[]) from authenticated;
grant execute on function public.project_memory_index_state(uuid, text, text[]) to service_role;

revoke all on function public.delete_project_memory_docs(uuid, text, text[]) from public;
revoke all on function public.delete_project_memory_docs(uuid, text, text[]) from anon;
revoke all on function public.delete_project_memory_docs(uuid, text, text[]) from authenticated;
grant execute on function public.delete_project_memory_docs(uuid, text, text[]) to service_role;
