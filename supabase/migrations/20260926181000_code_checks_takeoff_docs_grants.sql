-- 20260926181000_code_checks_takeoff_docs_grants.sql
--
-- Follow-up to 20260926180000. The schema's default privileges hand
-- `authenticated` ALL on a new public table, so after that migration's
-- grant it also held TRUNCATE, TRIGGER and REFERENCES on code_checks and
-- takeoff_docs. PostgREST exposes none of the three, but TRUNCATE is not
-- subject to RLS, so the client role keeps exactly the four verbs it uses.
-- Idempotent.
revoke truncate, trigger, references on public.code_checks, public.takeoff_docs from authenticated;
