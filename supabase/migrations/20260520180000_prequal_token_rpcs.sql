-- Audit Finding 10.1 — Sub portal prequal token model
--
-- Today's prequal-form.tsx uses the GC's local authed React-Query cache to
-- look up packets by invite_token, which means unauth subs see "Link
-- expired or invalid" even with a valid token. The token-bearer "no auth"
-- design noted in the file's own header comment was never actually wired
-- against the RLS perimeter.
--
-- Two SECURITY DEFINER RPCs mirror the portal_sign_contract pattern from
-- the May-18 portal-write-rpc-hardening migration:
--
--   lookup_prequal_packet_by_token(p_token text) → jsonb
--     - Returns the full packet row when token matches AND not expired.
--     - Returns NULL on miss or expiry.
--     - Anon + authenticated callable.
--
--   submit_prequal_packet(p_token, p_criteria, p_financials, p_safety,
--                         p_insurance, p_licenses, p_w9_on_file,
--                         p_w9_doc_path, p_status) → boolean
--     - Updates the row where invite_token matches AND not expired AND
--       status != 'approved' (never overwrites a finalized packet).
--     - Status can transition draft|invited|needs_changes → submitted,
--       but cannot regress from approved.
--     - Returns true if the row was updated, false otherwise.
--     - Anon + authenticated callable.
--
-- Reverse path: drop function lookup_prequal_packet_by_token(text);
--               drop function submit_prequal_packet(text, jsonb, jsonb,
--                 jsonb, jsonb, jsonb, boolean, text, text);

create or replace function public.lookup_prequal_packet_by_token(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
begin
  select to_jsonb(p) into rec
    from prequal_packets p
   where p.invite_token = p_token
     and (p.expires_at is null or p.expires_at > now())
   limit 1;
  return rec;
end;
$$;

revoke all on function public.lookup_prequal_packet_by_token(text) from public;
grant execute on function public.lookup_prequal_packet_by_token(text) to anon, authenticated;

create or replace function public.submit_prequal_packet(
  p_token text,
  p_criteria jsonb,
  p_financials jsonb,
  p_safety jsonb,
  p_insurance jsonb,
  p_licenses jsonb,
  p_w9_on_file boolean,
  p_w9_doc_path text,
  p_status text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update prequal_packets
     set criteria      = p_criteria,
         financials    = p_financials,
         safety        = p_safety,
         insurance     = p_insurance,
         licenses      = p_licenses,
         w9_on_file    = p_w9_on_file,
         w9_doc_path   = p_w9_doc_path,
         status        = case
           when p_status = 'submitted' and status in ('draft', 'invited', 'needs_changes')
             then 'submitted'
           else status
         end,
         submitted_at  = case
           when p_status = 'submitted' and submitted_at is null
             then now()
           else submitted_at
         end,
         updated_at    = now()
   where invite_token = p_token
     and (expires_at is null or expires_at > now())
     and status != 'approved';

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.submit_prequal_packet(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, text, text
) from public;
grant execute on function public.submit_prequal_packet(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, text, text
) to anon, authenticated;
