-- 20261005090000_ai_call_log.sql — one row per model call (lane AICOST).
--
-- WHY. Nothing recorded which model answered, how big the call was or what it
--   cost, so nobody could say what a feature costs or whether a plan's included
--   AI is profitable. Founder, 2026-10-04: "Record every AI call's cost, and put
--   an hourly limit on Construction Answers." This file is the record; the
--   limit is code (supabase/functions/construction-answer/limits.ts).
--
-- WHAT A ROW MEANS. One request an edge function made to a model provider
--   (Google Gemini, Anthropic Claude, the speech-to-text vendor): who it is
--   billed to, which feature and function made it, the provider and the exact
--   model id, the provider's own token counts, how long it took, how it ended
--   and a list-price estimate in millionths of a dollar. An agentic answer is
--   several calls, so several rows sharing one request_id.
--     user_id            the account the call is billed to (the metered account:
--                        the project owner when a collaborator or a homeowner
--                        asks). NULL for cron, and set NULL when that account is
--                        deleted: the cost stays, the person does not.
--     request_id         random per request, shared by its calls. Not content.
--     feature            the app's feature / metering key (ai_text, cost_xray,
--                        construction_answer, ...).
--     function           the edge function directory name.
--     input_tokens       the WHOLE prompt, cached and cache-written tokens included.
--     output_tokens      visible output (Anthropic: all output, thinking included).
--     thinking_tokens    Gemini thoughtsTokenCount (billed at the output rate).
--     cached_tokens      read from a cache (part of input_tokens).
--     cache_write_tokens Anthropic: written to a cache (part of input_tokens).
--     tool_calls         billed server-side tool uses (Anthropic web searches).
--     images, pdf_pages  attachments, where the call site knows the count.
--     outcome            ok | blocked | empty | error | timeout | refused, read
--                        from the provider's reply.
--     est_cost_micros    list-price estimate, 1,000,000 = one dollar. NULL when
--                        the model has no verified price or the provider gave no
--                        token counts: never a guess. The invoice is the truth.
--     price_version      the price table the estimate used
--                        (supabase/functions/_shared/aiPrices.ts PRICE_VERSION).
--   NOT IN A ROW, EVER: prompt text, answer text, file names, project content.
--   Every text column is an identifier the code chose; the writer strips
--   anything outside [A-Za-z0-9._:/-] and the check constraints below bound
--   their length.
--
-- WHO WRITES. Edge functions only, with the service role, through
--   supabase/functions/_shared/aiCallLog.ts (best-effort: a failed write loses
--   the row and nothing else). No client writes: no grant, no policy.
-- WHO READS. The service role and the SQL editor (postgres). No client reads:
--   row level security is ON with NO policies, and anon / authenticated hold
--   no privilege on the table at all.
-- RETENTION. 400 days (a full year plus a month to compare against), deleted
--   daily by pg_cron job ai-call-log-purge → public.ai_call_log_purge().
--
-- DEPLOY ORDER. Apply this BEFORE deploying the functions that log (the list
--   is in the lane's report). The reverse order is safe but pointless: the
--   insert fails quietly and no row is written. Apply through the Supabase MCP
--   apply_migration, never `supabase db push`. Depends on: auth.users.
--
-- VERIFY AFTER
--   select relrowsecurity from pg_class where oid = 'public.ai_call_log'::regclass;              -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'ai_call_log';  -- 0
--   select has_table_privilege('anon',          'public.ai_call_log', 'select'),                 -- false
--          has_table_privilege('anon',          'public.ai_call_log', 'insert'),                 -- false
--          has_table_privilege('authenticated', 'public.ai_call_log', 'select'),                 -- false
--          has_table_privilege('authenticated', 'public.ai_call_log', 'insert'),                 -- false
--          has_table_privilege('service_role',  'public.ai_call_log', 'select'),                 -- true
--          has_table_privilege('service_role',  'public.ai_call_log', 'insert');                 -- true
--   select has_function_privilege('anon',          'public.ai_call_log_purge()', 'execute'),     -- false
--          has_function_privilege('authenticated', 'public.ai_call_log_purge()', 'execute');     -- false
--   select indexname from pg_indexes where tablename = 'ai_call_log' order by 1;                 -- pkey + 4 idx_ai_call_log_*
--   select jobname, schedule from cron.job where jobname = 'ai-call-log-purge';                  -- one row, 23 8 * * *
--   -- after the functions are deployed and one AI feature has been used:
--   select created_at, function, feature, model, input_tokens, output_tokens, outcome, est_cost_micros
--     from public.ai_call_log order by created_at desc limit 5;
--
-- UNDO (by hand, only if the log is withdrawn; redeploy the functions first or
--   their inserts fail quietly)
--   select cron.unschedule('ai-call-log-purge');
--   drop function if exists public.ai_call_log_purge();
--   drop table if exists public.ai_call_log;
--
-- PROOF. scratchpad/pgq/ai-call-log.mjs applies this file twice on PGlite and
--   prints: anon / authenticated cannot read or write, the service role can, a
--   row with a bad outcome or a negative count is refused, deleting the account
--   keeps the row with user_id NULL, and the purge removes rows older than 400
--   days and nothing newer; its planted mutations turn those cases red.
--   scripts/validate-ai-call-log.ts pins this file's text and the writer's
--   column list.
--
-- Additive and idempotent: create table / index if not exists, create or
-- replace function, cron.schedule upserts by job name, grants and revokes that
-- are no-ops the second time.

-- ── 1. the table ─────────────────────────────────────────────────────────────
create table if not exists public.ai_call_log (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  user_id            uuid references auth.users(id) on delete set null,
  request_id         uuid,
  feature            text not null,
  function           text not null,
  provider           text not null,
  model              text not null,
  input_tokens       integer,
  output_tokens      integer,
  thinking_tokens    integer,
  cached_tokens      integer,
  cache_write_tokens integer,
  tool_calls         integer,
  images             integer,
  pdf_pages          integer,
  duration_ms        integer,
  outcome            text not null,
  http_status        integer,
  est_cost_micros    bigint,
  price_version      text,
  constraint ai_call_log_outcome_check
    check (outcome in ('ok', 'blocked', 'empty', 'error', 'timeout', 'refused')),
  -- Identifiers, not prose: short, and nothing but the characters a key uses.
  constraint ai_call_log_identifiers_check
    check (feature  ~ '^[A-Za-z0-9._:/-]{1,80}$'
       and function ~ '^[A-Za-z0-9._:/-]{1,80}$'
       and provider ~ '^[A-Za-z0-9._:/-]{1,80}$'
       and model    ~ '^[A-Za-z0-9._:/-]{1,80}$'
       and (price_version is null or price_version ~ '^[A-Za-z0-9._:/-]{1,40}$')),
  constraint ai_call_log_counts_check
    check (coalesce(input_tokens, 0) >= 0 and coalesce(output_tokens, 0) >= 0
       and coalesce(thinking_tokens, 0) >= 0 and coalesce(cached_tokens, 0) >= 0
       and coalesce(cache_write_tokens, 0) >= 0 and coalesce(tool_calls, 0) >= 0
       and coalesce(images, 0) >= 0 and coalesce(pdf_pages, 0) >= 0
       and coalesce(duration_ms, 0) >= 0 and coalesce(est_cost_micros, 0) >= 0)
);

comment on table public.ai_call_log is
  'One row per model call made by an edge function: metadata and a list-price estimate only (no prompt, no answer, no file name). Service role only. 400-day retention (ai-call-log-purge).';
comment on column public.ai_call_log.est_cost_micros is
  'List-price estimate in millionths of a dollar; NULL when the price or the token counts are unknown. See price_version.';

-- ── 2. indexes: by day, by account, by feature, by request ───────────────────
create index if not exists idx_ai_call_log_created_at   on public.ai_call_log (created_at);
create index if not exists idx_ai_call_log_user_created on public.ai_call_log (user_id, created_at);
create index if not exists idx_ai_call_log_feature_created on public.ai_call_log (feature, created_at);
create index if not exists idx_ai_call_log_request on public.ai_call_log (request_id) where request_id is not null;

-- ── 3. locks: service role only ──────────────────────────────────────────────
alter table public.ai_call_log enable row level security;
-- NO policies on purpose: no client reads or writes this table.
revoke all on public.ai_call_log from public, anon, authenticated;
grant select, insert, delete on public.ai_call_log to service_role;

-- ── 4. retention: 400 days ───────────────────────────────────────────────────
create or replace function public.ai_call_log_purge()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.ai_call_log where created_at < now() - interval '400 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.ai_call_log_purge() from public, anon, authenticated;
grant execute on function public.ai_call_log_purge() to service_role;

-- Plain SQL, no edge function, no secret. Guarded so a database without pg_cron
-- (PGlite, a fresh local one) applies the file cleanly. cron.schedule upserts by
-- job name.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ai-call-log-purge', '23 8 * * *', $j$ select public.ai_call_log_purge() $j$);
  end if;
end $$;

-- ── self-check ───────────────────────────────────────────────────────────────
-- Fail the apply, not a later request, if the locks did not land as written.
do $$
declare
  v_role text;
  v_priv text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.ai_call_log'::regclass) then
    raise exception '[ai_call_log] verify: row level security is off';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_call_log') then
    raise exception '[ai_call_log] verify: the table has a policy; it must have none';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(v_role, 'public.ai_call_log', v_priv) then
          raise exception '[ai_call_log] verify: % holds % on the table', v_role, v_priv;
        end if;
      end loop;
      if has_function_privilege(v_role, 'public.ai_call_log_purge()', 'execute') then
        raise exception '[ai_call_log] verify: % can run the purge', v_role;
      end if;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if not has_table_privilege('service_role', 'public.ai_call_log', 'insert')
       or not has_table_privilege('service_role', 'public.ai_call_log', 'select') then
      raise exception '[ai_call_log] verify: the service role cannot write or read the table';
    end if;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ai_call_log'
                and column_name in ('prompt', 'answer', 'question', 'response', 'content', 'text', 'file_name', 'filename', 'message', 'error_message')) then
    raise exception '[ai_call_log] verify: the table has a content column; it holds metadata only';
  end if;
end $$;
