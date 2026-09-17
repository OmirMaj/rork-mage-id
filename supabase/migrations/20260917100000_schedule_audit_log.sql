-- ============================================================================
-- schedule_audit_log — a server copy of the schedule change history.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- utils/scheduleAudit.ts records every schedule mutation (task edits, logic
-- changes, reflows, change-order reflows, baseline locks) into the AsyncStorage
-- key `mageid_schedule_audit::<projectId>`. That was the ONLY copy:
--   * it is under the `mageid_` prefix, so AuthContext.wipeLocalUserCache
--     removes it on every sign-out and tenant switch;
--   * it never left the device, so the laptop and the phone each held a
--     different half of the history;
--   * delay_events.evidence (a server row) now carries POINTERS into it —
--     {kind: 'schedule_audit', id: <entry id>} — which dangle the moment the
--     register is opened on another device or after a sign-out.
-- A delay claim is argued months after the fact from exactly this record, so
-- "the history was on the old phone" is not an acceptable failure.
--
-- ── ONE ROW PER ENTRY, KEYED ON THE ENTRY'S OWN ID ─────────────────────────
-- Entries are append-only and carry a client-minted id (buildAuditEntry), so
-- `id` is the primary key and every write is an upsert on it
-- (utils/offlineQueue.supabaseWrite 'upsert'). An offline-queue replay, a
-- backfill that races a live push, or the same entry sent from a hydrate all
-- land on the one row. text, not uuid: the id falls back to `aud_<ts>_<rand>`
-- where crypto.randomUUID is missing, and project ids are client-generated text.
--
-- ── APPEND-ONLY, ENFORCED ───────────────────────────────────────────────────
-- An upsert needs UPDATE (PostgREST's merge-duplicates), so UPDATE is granted —
-- but a BEFORE UPDATE trigger keeps the FIRST-written content: a replay is a
-- no-op, and a later write cannot rewrite what an entry says, when it happened,
-- who made it, or which project it belongs to. It returns the old row silently
-- rather than raising, because offlineQueue classifies a raised error as
-- terminal and would toast "Couldn't save" over an idempotent replay.
-- No DELETE grant and no DELETE policy: nothing in the app deletes history, and
-- the API should not offer it. Deleting the auth user still cascades.
-- This is NOT a seal — there is no content hash, and the service role can still
-- change rows. Do not describe these rows as tamper-proof.
--
-- ── RLS: OWNER-ONLY, TO authenticated ───────────────────────────────────────
-- A row belongs to the user who WROTE it (`auth.uid() = user_id`), the
-- delay_events / last_planner_* shape. Decision, stated plainly: a
-- collaborator's edits to someone else's project are logged under the
-- collaborator's own account and are NOT visible to the project owner, and the
-- owner's history is not visible to collaborators. delay_events is owner-only
-- (20260804120000 — the contractual cluster stays off the collaborator line),
-- so the register that points into this log can only be opened by its owner
-- anyway; widening the log alone would expose who-changed-what to viewers with
-- no register to use it in. Sharing it is a product decision for when a real
-- field role exists, not a default. The delay register says so when a pointer
-- cannot be resolved ("may have been recorded under another account").
--
-- ── ORDER OF OPERATIONS ─────────────────────────────────────────────────────
-- APPLY THIS BEFORE ANY OTA THAT SHIPS THE SYNC. Before the table exists every
-- push hits a PostgREST schema-cache miss that utils/offlineQueue.ts treats as
-- TRANSIENT and re-queues: nothing is lost, nothing syncs, and every schedule
-- edit adds a row to mageid_offline_queue (FIFO-capped — enough edits push out
-- someone's daily report) until this lands. Reads go through a try/catch and
-- the screens keep working from AsyncStorage, labelled "on this device only".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.schedule_audit_log (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  -- When the change happened on the device (ScheduleAuditEntry.at) — which may
  -- be days before an offline device first reached the server.
  at timestamptz NOT NULL,
  -- ScheduleAuditEntry.user: the display identity the device recorded (email,
  -- else name, else 'anonymous'). Kept verbatim beside user_id because it is
  -- what the History viewer has always shown, and the type reserves it for a
  -- share-link sub who has no auth id of their own.
  actor text NOT NULL DEFAULT '',
  -- No CHECK on kind: a kind added to the client union later would otherwise be
  -- a TERMINAL write error, and a history that silently skips a whole kind of
  -- change is worse for a claim than an unexpected label.
  kind text NOT NULL,
  task_id text,
  task_title text,
  change_order_id text,
  summary text NOT NULL DEFAULT '',
  before jsonb,
  after jsonb,
  -- When the SERVER first received the row. Distinct from `at` on purpose: the
  -- gap between them is the honest answer to "was this written at the time?".
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_audit_log_owner_project_at_idx
  ON public.schedule_audit_log(user_id, project_id, at DESC);

-- ── Append-only: an UPDATE keeps the first-written row ──────────────────────
-- search_path pinned: an unpinned function is the Supabase advisor's
-- function_search_path_mutable warning, and it costs nothing to close.
CREATE OR REPLACE FUNCTION public.schedule_audit_log_keep_first_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
  RETURN OLD;
END;
$body$;

DROP TRIGGER IF EXISTS schedule_audit_log_append_only ON public.schedule_audit_log;
CREATE TRIGGER schedule_audit_log_append_only
  BEFORE UPDATE ON public.schedule_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.schedule_audit_log_keep_first_write();

-- ── RLS (owner-only, TO authenticated; no DELETE) ───────────────────────────
ALTER TABLE public.schedule_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_audit_log_select ON public.schedule_audit_log;
DROP POLICY IF EXISTS schedule_audit_log_insert ON public.schedule_audit_log;
DROP POLICY IF EXISTS schedule_audit_log_update ON public.schedule_audit_log;
DROP POLICY IF EXISTS schedule_audit_log_delete ON public.schedule_audit_log;

CREATE POLICY schedule_audit_log_select ON public.schedule_audit_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY schedule_audit_log_insert ON public.schedule_audit_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY schedule_audit_log_update ON public.schedule_audit_log
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- REVOKE ALL, not just DELETE: Supabase's default privileges hand
-- `authenticated` every table privilege, TRUNCATE included, and RLS does not
-- apply to TRUNCATE. PostgREST does not expose it, but a history table should
-- not rely on that.
REVOKE ALL ON public.schedule_audit_log FROM anon;
REVOKE ALL ON public.schedule_audit_log FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.schedule_audit_log TO authenticated;

COMMENT ON TABLE public.schedule_audit_log IS
  'Server copy of utils/scheduleAudit entries. id is the entry''s own id; '
  'writes are upserts and an UPDATE keeps the first-written row (append-only). '
  'Owner-only (the writing user); no DELETE.';

-- ============================================================================
-- VERIFY AFTER APPLYING
--
-- 1. Three policies, owner-scoped, TO authenticated, none for DELETE:
--    select p.polname, p.polcmd, pg_get_expr(p.polqual, p.polrelid),
--           pg_get_expr(p.polwithcheck, p.polrelid), p.polroles::regrole[]
--    from pg_policy p join pg_class c on c.oid = p.polrelid
--    where c.relname = 'schedule_audit_log' order by 1;
--
-- 2. Append-only: upsert the same id twice with a different summary — the
--    first summary must remain.
--
-- 3. Cross-tenant: as user B, `select count(*) from public.schedule_audit_log`
--    returns 0 for A's rows, and an upsert on one of A's ids is rejected.
--
-- 4. The queue drains. NOTIFY pgrst, 'reload schema' (or wait ~a minute), open
--    a schedule's History on a device that had queued writes, and confirm
--    mageid_offline_queue empties and the rows appear here.
-- ============================================================================
