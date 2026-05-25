# Selections Auto-Photo (og:image) — Design

**Date:** 2026-05-25
**Status:** Approved (design) — ready for implementation plan
**Scope:** Auto-populate material photos on **Selections** so the GC never hand-uploads images and the client portal shows real product pictures. Primary source: **og:image** scraped from a product URL (free). Fallback: **Pexels** stock by keyword (free) so a photo always renders.

## Problem (from audit)

`SelectionOption` already has `imageUrl` + `productUrl` (types/index.ts:350), `saveSelectionOption` already maps `image_url`/`product_url` to the `selection_options` table (no migration needed), and the **portal already renders the option image** (`.sel-swatch img`, tap-to-zoom). But **nothing populates the image**: `app/selections.tsx` has no image UI, and `curateSelectionsAI` returns no `productUrl`/`imageUrl`. So every selection option is photo-less and the portal's image slots sit empty.

## Goal

When the GC taps **"Curate with AI"**, each option comes back **with a photo already attached** (zero manual work). The GC can also paste a product link on any option to set/override the exact photo. Cost stays **$0**.

## Architecture (one new edge function + client wiring; OTA-safe except the fn deploy)

### 1. New edge function `supabase/functions/og-image/index.ts`
- **Input:** `{ url?: string; query?: string }`.
- **Behavior:**
  1. If `url` is a valid http(s) URL: server-fetch it with a real browser `User-Agent` + `Accept: text/html`, 8s timeout, follow redirects. Parse the HTML for `<meta property="og:image" content="...">`, then `<meta name="twitter:image" ...>`, then `<link rel="image_src" ...>`. Return the first absolute https image URL found.
  2. If no `url`, or the fetch/parse yields nothing, **and** `query` is provided **and** a `PEXELS_API_KEY` secret is set: call Pexels `GET https://api.pexels.com/v1/search?query=<query>&per_page=1&orientation=square` with the key → return `photos[0].src.medium`.
  3. Else return `{ success: true, imageUrl: null }` (caller leaves the option photo-less — not an error).
- **Output:** `{ success: boolean, imageUrl: string | null, source?: 'og' | 'pexels', error?: string }`.
- **Auth:** `requireTier(req, ['pro','business'], 'og_image')` (Selections is a Pro+ feature). **No monthly cap / no usage increment** — the call is free (an HTTP fetch / free Pexels tier), so it doesn't consume an AI quota.
- **Safety:** only fetch http(s); cap the response body read (e.g. 2 MB of HTML) before parsing; never echo the page body or the Pexels key in the response. `verify_jwt: true` (deploy default).

### 2. Extend `curateSelectionsAI` (`utils/selectionsEngine.ts`)
- Add `productUrl: string` to `CuratedOption`, the zod `aiOptionSchema`, and the prompt: *"productUrl — a real product or search page URL at the named supplier for this exact item (e.g. a Home Depot / Build.com / Wayfair product or search URL)."*
- Map `productUrl` through in the `curateSelectionsAI` mapping and in `saveCuratedOptions`'s row builder (it currently omits `image_url`/`product_url` — add both).

### 3. Image resolver helper `utils/ogImage.ts` (client)
- `resolveSelectionImage(opts: { url?: string; query?: string }): Promise<string | null>` → `supabase.functions.invoke('og-image', { body: opts })`, returns `data.imageUrl ?? null` (never throws; returns null on error so curation/save still proceeds).

### 4. Wire auto-resolve into the curate flow (`app/selections.tsx` `handleCurate`)
After `curateSelectionsAI` returns options, for each option resolve its image **before** saving:
`imageUrl = await resolveSelectionImage({ url: opt.productUrl, query: \`${opt.brand} ${opt.productName} ${cat.category}\` })`.
Run them with bounded concurrency (e.g. `Promise.all` over the ≤4 options — small set). Then `saveCuratedOptions` persists `imageUrl` + `productUrl`. Show the existing curating spinner during the (slightly longer) resolve+save.

### 5. Selections screen UI (`app/selections.tsx`)
- **`OptionRow`:** render a small thumbnail (≈44×44, rounded) when `option.imageUrl` is set, left of the product name. Keep the existing "Link" chip for `productUrl`.
- **Per-option photo control:** in the option's detail/choose affordance, add a lightweight **"Set photo from link"** action — GC pastes a product URL → calls `resolveSelectionImage({ url })` → on success `saveSelectionOption({ ...option, productUrl, imageUrl })` (exact override). On miss, toast "No image found at that link."

### 6. Portal
No change — `.sel-swatch img` already renders `imageUrl` with tap-to-zoom. Once populated, photos appear for the client automatically.

## Reliability
- og:image is hit-or-miss: AI-guessed URLs can 404 and some retailers bot-wall server fetches → those options fall through to the **Pexels** keyword fallback so a tasteful (generic) photo always shows; a manual paste gives the exact one.
- All failures are non-fatal: a null image just leaves the option without a picture; curation/save never breaks.

## Cost
**$0.** og:image is a plain HTTP fetch; Pexels is free-tier. Each image is resolved **once and cached** on the option (`image_url`), never re-fetched on view. A project resolves at most a few dozen images, one time.

## Edge cases
- No `PEXELS_API_KEY` set → Pexels fallback is skipped; feature degrades to og:image + manual paste (still works).
- Invalid/non-http URL → `imageUrl: null`.
- Offline / fn error → resolver returns null; curation still saves text-only options.
- Re-curate → replaces options (existing behavior); images re-resolve.

## OTA-safety
Client pieces (selectionsEngine, ogImage helper, app/selections.tsx) are pure JS → **OTA**. The `og-image` edge function is a **separate deploy** (Supabase CLI/MCP), `verify_jwt` default true. **No migration** (`image_url`/`product_url` columns already exist). Pexels key (optional) is a server secret.

## Out of scope (v1)
- Paid search-by-name image APIs (SerpAPI/Google) — og:image + Pexels cover it at $0.
- Bulk re-scrape of existing photo-less options (only new curations / manual paste get images).
- Client-side scraping (CORS-blocked — must be server-side).
- Caching/CDN-proxying the remote image (we store the source URL; the portal/app load it directly).

## File structure
- **Create** `supabase/functions/og-image/index.ts` — the scraper/Pexels fn.
- **Create** `utils/ogImage.ts` — `resolveSelectionImage` client wrapper.
- **Modify** `utils/selectionsEngine.ts` — `CuratedOption.productUrl` + schema + prompt; `saveCuratedOptions` row maps `image_url`/`product_url`.
- **Modify** `app/selections.tsx` — auto-resolve in `handleCurate`; `OptionRow` thumbnail; "Set photo from link" affordance.
- **Reuse:** `saveSelectionOption` (already maps image_url/product_url), portal `.sel-swatch` (already renders).
- **Add server secret (optional):** `PEXELS_API_KEY`.

## Testing & gates
No unit runner. Per-task gate `npx tsc --noEmit` clean + grep. Strict TS, theme-aware, OTA-safe client. The edge fn is type-checked at deploy. Manual: curate a category → options arrive with photos; paste a Home Depot link on an option → exact photo; confirm the portal shows the swatches.
