-- public-lead-intake: resolve a public company slug to the owning GC's user_id.
--
-- The public portfolio page lives at mageid.app/builders/<companySlug>/<project>,
-- where companySlug = slugify(profiles.company_name) computed client-side. The
-- public-lead-intake edge function needs the reverse: slug -> user_id, so an
-- anonymous "request a quote" submission lands in the right contractor's
-- Pipeline. SECURITY DEFINER so it can read profiles past RLS; it returns ONLY
-- the id, never any PII.
--
-- The slug normalization mirrors utils/publicProfileSnapshot.ts slugify():
--   lower -> non-alphanumeric runs to '-' -> trim leading/trailing '-' -> 60 chars
-- (Accent-stripping NFKD is omitted here; ASCII company names match exactly.
--  For accented names, prefer the v1.5 path of an explicit, unique company_slug
--  column claimed in-app.)

create or replace function public.gc_user_for_company_slug(p_slug text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where coalesce(p.company_name, '') <> ''
    and left(
          trim(both '-' from regexp_replace(lower(p.company_name), '[^a-z0-9]+', '-', 'g')),
          60
        ) = lower(trim(coalesce(p_slug, '')))
  order by p.id
  limit 1;
$$;

comment on function public.gc_user_for_company_slug(text) is
  'Resolve a public company slug (slugify(company_name)) to the owning GC user_id for the public lead funnel. Returns only the id.';

-- The edge function calls this via the REST rpc endpoint using the service-role
-- key, but grant explicitly so the intent is clear and a future anon caller works.
grant execute on function public.gc_user_for_company_slug(text) to anon, authenticated, service_role;

-- Note: the lead INSERT itself is performed by the edge function with the
-- service-role key, which bypasses RLS — no new INSERT policy on public.leads is
-- required. Leads land with source='website', stage='new', and are visible only
-- to the owning GC under the existing per-user RLS on public.leads.
