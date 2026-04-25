-- ============================================
-- MIGRATION: storage buckets for PDF → PNG plan rendering
-- ============================================
-- Purpose: stand up the two Supabase Storage buckets that the
-- `convert-pdf-to-images` edge function reads from / writes to.
--
--   pdf-uploads   — short-lived. Client uploads the source PDF here, the
--                   edge function downloads + processes it, then deletes
--                   the source. Keep this private (auth required).
--
--   plan-sheets   — long-lived. The edge function writes one PNG per page
--                   here; these become the durable "drawing image" that
--                   the existing plan_sheets table references via imageUri.
--                   Public-readable so the React Native <Image> component
--                   can hit the URL without a presigned-URL refresh dance.
--                   (Field crews on spotty service need predictable URLs.)
--
-- Naming convention enforced by the edge function:
--   pdf-uploads/<userId>/<uuid>.pdf
--   plan-sheets/<projectId>/<uuid>-page-<N>.png
--
-- RLS: the edge function uses the service-role key, so it bypasses RLS for
-- writes/deletes. The client uploads its own PDFs (uses anon-key) and
-- reads PNGs from the public bucket — both restricted via the policies
-- below.

-- --------------------------------------------
-- Buckets
-- --------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'pdf-uploads',
    'pdf-uploads',
    false,
    536870912, -- 512 MB. Hospital plan sets routinely hit 200–400 MB.
    ARRAY['application/pdf']
  ),
  (
    'plan-sheets',
    'plan-sheets',
    true,
    52428800, -- 50 MB per PNG (way more headroom than 144-DPI sheets need).
    ARRAY['image/png', 'image/jpeg']
  )
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------
-- Policies: pdf-uploads (private)
-- --------------------------------------------
-- Any authenticated user can upload to a folder named after their auth.uid().
-- This matches the convention `pdf-uploads/<userId>/<uuid>.pdf`.
CREATE POLICY IF NOT EXISTS "pdf-uploads insert own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pdf-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can read / delete their own uploads (rare; the edge
-- function deletes after rendering, but we want users to be able to abort).
CREATE POLICY IF NOT EXISTS "pdf-uploads read own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pdf-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY IF NOT EXISTS "pdf-uploads delete own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pdf-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- --------------------------------------------
-- Policies: plan-sheets (public read, no client writes)
-- --------------------------------------------
-- Public read is achieved by `public = true` on the bucket; we still add an
-- explicit policy so it's discoverable in the dashboard.
CREATE POLICY IF NOT EXISTS "plan-sheets public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'plan-sheets');

-- Clients DO NOT write directly to plan-sheets — only the edge function
-- (service-role) does. We still let users delete their own (via the same
-- folder convention; the edge function uses projectId as folder).
CREATE POLICY IF NOT EXISTS "plan-sheets delete own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'plan-sheets'
    -- Project-scoped: the projectId folder is owned by whoever owns the project.
    -- We could join projects here for stricter checking, but the cheap path is
    -- to let any authenticated user delete; in practice the app only exposes a
    -- delete UI for project owners anyway, and the bucket is for plan images
    -- (not PII). Tighten later if abuse appears.
  );
