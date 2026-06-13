-- Project Memory v2 — semantic (pgvector) retrieval.
--
-- v1 (utils/projectMemory) does client-side TF-IDF over a project's records.
-- This adds the semantic-search backend: per-record embeddings + cosine ANN, so
-- "rebar" matches "reinforcement" and intent matches paraphrase. The client
-- prefers this when deployed and falls back to TF-IDF when it isn't.
--
-- Embeddings: Gemini text-embedding-004 → 768 dims (see _shared/embeddings.ts).
-- Requires the pgvector extension (>= 0.5 for hnsw; falls back to ivfflat below).

create extension if not exists vector;

create table if not exists public.memory_embeddings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  project_id  text not null,
  doc_id      text not null,          -- stable client MemoryDoc.id (e.g. "rfi-<uuid>")
  source      text not null,          -- 'RFI' | 'Daily Report' | ...
  ref         text not null,          -- citation label, e.g. "RFI #12"
  content     text not null,
  embedding   vector(768) not null,
  updated_at  timestamptz not null default now(),
  unique (user_id, doc_id)
);

create index if not exists memory_embeddings_user_project_idx
  on public.memory_embeddings (user_id, project_id);

-- Cosine ANN index. hnsw is preferred (better recall, no training); if your
-- pgvector is < 0.5, swap for: ivfflat (embedding vector_cosine_ops) with (lists = 100).
create index if not exists memory_embeddings_vec_idx
  on public.memory_embeddings using hnsw (embedding vector_cosine_ops);

-- RLS: a user sees only their own rows. The edge functions use the service-role
-- key (bypasses RLS) for embed/search; these policies protect any direct access.
alter table public.memory_embeddings enable row level security;

drop policy if exists memory_embeddings_owner on public.memory_embeddings;
create policy memory_embeddings_owner on public.memory_embeddings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Cosine similarity search, scoped to a (user, project). Called by the
-- project-memory-search edge function with the service-role key, passing the
-- authenticated user's id explicitly. p_query is the query vector as a text
-- literal ("[v1,v2,...]") to avoid JSON→vector coercion over PostgREST.
create or replace function public.match_project_memory(
  p_user_id uuid,
  p_project_id text,
  p_query text,
  p_match_count int
) returns table (doc_id text, source text, ref text, content text, similarity float)
language sql stable security definer set search_path = public
as $$
  select e.doc_id, e.source, e.ref, e.content,
         1 - (e.embedding <=> (p_query)::vector) as similarity
  from public.memory_embeddings e
  where e.user_id = p_user_id
    and e.project_id = p_project_id
  order by e.embedding <=> (p_query)::vector
  limit greatest(1, least(coalesce(p_match_count, 8), 24));
$$;

comment on function public.match_project_memory(uuid, text, text, int) is
  'Cosine top-K over a project''s memory embeddings, scoped to one user. For Project Memory v2 semantic search.';

grant execute on function public.match_project_memory(uuid, text, text, int) to service_role, authenticated;
