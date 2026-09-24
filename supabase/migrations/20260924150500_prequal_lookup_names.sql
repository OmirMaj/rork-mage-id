-- Q5 (2026-09-24) — the prequal form names who is asking.
--
-- A sub opening a prequal link is signed out (the normal case), so the form
-- had no way to learn the GC's company or even the sub's own: the header read
-- "Prequalification · MAGE ID / your company". A form from an unknown sender
-- that asks for revenue, bonding and insurance limits and names nobody reads
-- like phishing.
--
-- lookup_prequal_packet_by_token now also returns:
--   gc_company_name  — the packet OWNER's profiles.company_name (falling
--                      back to the owner's profiles.name when no company is
--                      set), read here rather than passed in, so the page
--                      cannot be made to show a name the account does not
--                      have (same rule as lien_waiver_get_for_signing,
--                      20260908120200).
--   sub_company_name — the GC's roster row for this sub (subcontractors,
--                      same owner). subcontractor_id is text and
--                      subcontractors.id is uuid, so they are compared as
--                      text: a malformed id finds nothing instead of raising.
-- Both are '' when unknown. Every other key is unchanged (to_jsonb of the
-- row), so a form built before this reads the result exactly as before.
--
-- Match and expiry rules are unchanged: token equality, and expires_at null
-- or in the future. Tokens minted before the CSPRNG change (24 chars) still
-- match. An empty token matches nothing.
--
-- Reverse path: re-run the function from 20260520180000_prequal_token_rpcs.sql.

create or replace function public.lookup_prequal_packet_by_token(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_p   public.prequal_packets%rowtype;
  v_gc  text;
  v_sub text;
begin
  if coalesce(p_token, '') = '' then
    return null;
  end if;

  select * into v_p
    from public.prequal_packets p
   where p.invite_token = p_token
     and (p.expires_at is null or p.expires_at > now())
   limit 1;
  if not found then
    return null;
  end if;

  select coalesce(nullif(btrim(pr.company_name), ''), nullif(btrim(pr.name), '')) into v_gc
    from public.profiles pr
   where pr.id = v_p.user_id
   limit 1;

  select nullif(btrim(s.company_name), '') into v_sub
    from public.subcontractors s
   where s.id::text = v_p.subcontractor_id
     and s.user_id = v_p.user_id
   limit 1;

  return to_jsonb(v_p) || jsonb_build_object(
    'gc_company_name',  coalesce(v_gc, ''),
    'sub_company_name', coalesce(v_sub, '')
  );
end;
$function$;

revoke all on function public.lookup_prequal_packet_by_token(text) from public;
grant execute on function public.lookup_prequal_packet_by_token(text) to anon, authenticated;
