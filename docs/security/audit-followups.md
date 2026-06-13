# Security audit — remaining follow-ups (2026-06-12)

The full adversarial audit found RLS correctly scoped and no IDOR in the MCP
path. Cross-tenant exposures were fixed (PR #52 + the hardening PR). Remaining,
ranked. None are anon-reachable data leaks; they are hardening / lower-severity.

## Needs the Supabase dashboard (1-click)
- **Enable leaked-password protection.** Authentication → Policies → "Leaked
  password protection" (HaveIBeenPwned). Not settable via SQL/MCP.

## Deferred — breakage risk, low severity
- **Move `pg_net` out of the `public` schema.** INFO-level advisory. The notify
  triggers call `net.http_post` (already schema-qualified), but relocating the
  extension is fiddly and risks the notification pipeline. Low ROI; revisit
  during a maintenance window.

## Scoped refactor — touches the AI pipeline (needs device testing)
- **`plan-sheets` fully private + signed URLs.** Today the bucket is `public`
  (object reads work by URL; enumeration is already killed — the listing policy
  was dropped). Paths are unguessable UUIDs, so residual risk is low, but a URL
  leak = readable. Proper fix:
    1. `update storage.buckets set public=false where id='plan-sheets'`.
    2. `convert-pdf-to-images`: return `storagePath` instead of `getPublicUrl`;
       generate `createSignedUrl(path, ttl)` for the analyze-takeoff hand-off.
    3. Read sites (compare-drawings, plan-viewer, area-takeoff, plan-intelligence)
       generate a signed URL on display instead of persisting a public one.
       NOTE: persisted `planSheets[].imageUri` public URLs must be migrated.
  Do this with device testing — it touches the takeoff / Plan-Intelligence read
  path in 4+ places.

## Low severity
- **OpenWeather key in the client bundle** (`EXPO_PUBLIC_OPENWEATHER_API_KEY`,
  utils/weatherService.ts). Extractable → quota abuse only. Fix: proxy weather
  through an edge function using the server-side `OPENWEATHER_API_KEY` (already
  set for morning-digest) and drop the public env var.

## Done (this round)
- Tier self-upgrade trigger — applied live.
- Storage cross-tenant lockdown (plan-sheets/project-documents/sub-documents) — live.
- schedule-ical / schedule-ical-url ownership — live.
- search_path pinned on 8 functions — live.
- MCP token expiry column (1-yr default) — live; reader enforcement committed
  (deploy: `supabase functions deploy mcp`).
- unsubscribe now requires the signed token (no arbitrary suppression) —
  committed (deploy: `supabase functions deploy unsubscribe`).
- convert-pdf-to-images IDOR guard — committed in PR #52
  (deploy: `supabase functions deploy convert-pdf-to-images`).
