-- email_unsubscribes
--
-- Honors the List-Unsubscribe header (RFC 8058 / Gmail Feb-2024 bulk-sender
-- requirement). When a recipient clicks the unsubscribe link in an email
-- footer, the static page at mageid.app/unsubscribe POSTs to the
-- `unsubscribe` edge function which inserts a row here. Notify checks
-- this table before every send and skips suppressed addresses.
--
-- One row per (email, event_key). NULL event_key = unsubscribed from EVERY
-- transactional category. Specific event_key = opted out of just that one.

CREATE TABLE IF NOT EXISTS email_unsubscribes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  event_key text,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  -- Where the unsub came from. Useful for telemetry / abuse detection.
  --   'one_click'         = clicked the List-Unsubscribe URL
  --   'preferences_page'  = used the email-preferences UI
  --   'reply_unsubscribe' = manually flagged from an inbox reply
  source text,
  UNIQUE (email, event_key)
);

-- Lookup is "is this email + event suppressed?" — exactly the pattern
-- a btree on (email, event_key) handles.
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_email ON email_unsubscribes (email);
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_lookup ON email_unsubscribes (email, event_key);

-- RLS: nobody reads this from the client. Only the service role
-- (edge functions) can read/write. Suppressions are not user data the
-- recipient needs to query — they just need the unsub to take effect.
ALTER TABLE email_unsubscribes ENABLE ROW LEVEL SECURITY;

-- Helper: is this address suppressed for a given event? Used by the
-- notify function via RPC. Returns true if there's an unsubscribe row
-- matching the event_key OR a "global" (NULL event_key) unsubscribe.
CREATE OR REPLACE FUNCTION is_email_unsubscribed(p_email text, p_event_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM email_unsubscribes
    WHERE email = lower(p_email)
      AND (event_key IS NULL OR event_key = p_event_key)
  );
$$;

-- Allow the anon key to call the RPC for read-only checks. (Notify
-- itself uses service_role; this just lets the unsubscribe edge fn
-- use the same helper from anon callers.)
GRANT EXECUTE ON FUNCTION is_email_unsubscribed(text, text) TO anon, authenticated;
