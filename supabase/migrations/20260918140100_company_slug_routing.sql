-- Website-lead routing by company-name slug (audit round 2, #10).
--
-- gc_user_for_company_slug is how public-lead-intake (the /builders quote form)
-- and widget-estimate (a non-uuid data-mage-contractor) find the contractor a
-- homeowner's lead belongs to. It returned `order by p.id limit 1` of every
-- profile whose company name slugs to the value, so:
--   * two accounts called "Summit Builders" → every lead for either went to
--     whichever id sorted first — a free-text rename was enough to collect a
--     competitor's homeowners (name, phone, email, address, scope);
--   * a GC with NO company name was handed a snippet reading "project"
--     (utils/publicProfileSnapshot.ts slugify('') → 'project'), and "project"
--     resolved to any account whose name slugs to it — every nameless GC's
--     widget leads, to one stranger;
--   * the app strips accents before slugging ("Émile" → "emile") and this did
--     not ("-mile" → "mile"), so an accented name never matched at all.
-- Now: accents are stripped the same way the app strips them (NFKD, then drop
-- the combining marks), the literal fallback 'project' never resolves, and a
-- slug that matches more than one profile resolves to NOBODY — a lost lead the
-- homeowner is told about beats a lead handed to the wrong company. New widget
-- snippets embed the contractor's immutable account id instead
-- (app/widget-setup.tsx); this path remains for snippets and portfolio pages
-- already live.
--
-- CREATE OR REPLACE keeps the existing grants (service_role only in production).

create or replace function public.gc_user_for_company_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (
    select lower(trim(coalesce(p_slug, ''))) as s
  ),
  matches as (
    select p.id
    from public.profiles p, wanted w
    where w.s <> ''
      and w.s <> 'project'
      and coalesce(trim(p.company_name), '') <> ''
      and left(
            trim(both '-' from regexp_replace(
              regexp_replace(normalize(lower(p.company_name), NFKD), '[̀-ͯ]', '', 'g'),
              '[^a-z0-9]+', '-', 'g')),
            60
          ) = w.s
  )
  select case when (select count(*) from matches) = 1 then (select id from matches) end;
$$;

comment on function public.gc_user_for_company_slug(text) is
  'Resolve a public company slug (slugify(company_name), accents stripped) to the one GC user_id it names; NULL when none or more than one profile matches, and for the empty-name fallback ''project''. Returns only the id.';
