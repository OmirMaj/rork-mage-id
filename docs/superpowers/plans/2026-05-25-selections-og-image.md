# Selections Auto-Photo (og:image) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-attach product photos to Selection options (from a product URL's og:image, with a free Pexels keyword fallback) so the GC never hand-uploads and the client portal shows real material pictures.

**Architecture:** A new `og-image` edge function scrapes `og:image` server-side (CORS-safe) with a Pexels fallback. `curateSelectionsAI` gains a `productUrl` per option; after curation the client resolves each option's image once and stores it on the option (`image_url` column already exists — no migration). The portal already renders the image.

**Tech Stack:** Deno edge fn (mirrors `analyze-plan-code`), `expo`/React Native client, `supabase.functions.invoke`, zod.

**Per-task gate (NO unit runner):** `npx tsc --noEmit` clean at the worktree root + the grep assertion, then commit. Strict TS, no `any`, theme-aware, OTA-safe client. The edge fn is type-checked at deploy. **Do NOT deploy / `eas update` during the plan** — ship is a separate step. Worktree root: `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`.

---

## File Structure
- **Create** `supabase/functions/og-image/index.ts` — scrape og:image (+ Pexels fallback). Owns: fetch, parse, auth.
- **Create** `utils/ogImage.ts` — `resolveSelectionImage` client wrapper (never throws).
- **Modify** `utils/selectionsEngine.ts` — `CuratedOption.productUrl`/`imageUrl`, `aiOptionSchema.productUrl`, prompt, `curateSelectionsAI` mapping, `saveCuratedOptions` row (`image_url`/`product_url`).
- **Modify** `app/selections.tsx` — auto-resolve images in `handleCurate`; `OptionRow` thumbnail; per-option "Set photo from link" (iOS).

---

## Task 1: `og-image` edge function

**Files:** Create `supabase/functions/og-image/index.ts`

Mirror the structure of `supabase/functions/analyze-plan-code/index.ts` (CORS headers, `jsonResponse`, `serve`, `requireTier` guard).

- [ ] **Step 1: Create the file**

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";

const PEXELS_API_KEY = Deno.env.get("PEXELS_API_KEY") || "";
const MAX_HTML_SCAN = 200_000; // only the <head> region matters for og tags
const FETCH_TIMEOUT_MS = 8000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

interface OgImageRequest { url?: string; query?: string }

function isHttpUrl(u: string): boolean {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; }
}

// Extract the first og:image / twitter:image / image_src from HTML head.
function extractOgImage(html: string, baseUrl: string): string | null {
  const head = html.slice(0, MAX_HTML_SCAN);
  const metaTags = head.match(/<meta[^>]+>/gi) ?? [];
  const pick = (needle: RegExp): string | null => {
    for (const tag of metaTags) {
      if (needle.test(tag)) {
        const m = tag.match(/content=["']([^"']+)["']/i);
        if (m && m[1]) return m[1];
      }
    }
    return null;
  };
  let img = pick(/(property|name)=["']og:image(:secure_url)?["']/i)
    ?? pick(/name=["']twitter:image(:src)?["']/i);
  if (!img) {
    const link = head.match(/<link[^>]+rel=["']image_src["'][^>]*>/i)?.[0];
    if (link) img = link.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
  }
  if (!img) return null;
  try { return new URL(img, baseUrl).toString(); } catch { return null; }
}

async function fetchOgImage(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("xml")) return null;
    const html = await r.text();
    return extractOgImage(html, r.url || url);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function fetchPexels(query: string): Promise<string | null> {
  if (!PEXELS_API_KEY || !query.trim()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=square`, { headers: { Authorization: PEXELS_API_KEY }, signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const src = j?.photos?.[0]?.src;
    return src?.medium ?? src?.large ?? src?.original ?? null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const auth = await requireTier(req, ["pro", "business"], "og_image");
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  try {
    const body = await req.json() as OgImageRequest;
    let imageUrl: string | null = null;
    let source: "og" | "pexels" | undefined;
    if (body.url && isHttpUrl(body.url)) {
      imageUrl = await fetchOgImage(body.url);
      if (imageUrl) source = "og";
    }
    if (!imageUrl && body.query) {
      imageUrl = await fetchPexels(body.query);
      if (imageUrl) source = "pexels";
    }
    return jsonResponse({ success: true, imageUrl, source });
  } catch (e) {
    console.error("[og-image] failed", e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
```

- [ ] **Step 2: Confirm `requireTier` import shape** — `grep -n "export async function requireTier\|AuthSuccess\|AuthFailure\|auth.ok\|auth.body\|auth.status" supabase/functions/_shared/auth.ts | head`. Expected: `requireTier(req, allowed, featureName)` → `{ ok, userId, tier } | { ok:false, status, body }`. Matches the usage above (same as `analyze-plan-code`).

- [ ] **Step 3: App type-check unaffected** — `npx tsc --noEmit` → clean (the `supabase/functions/**` dir is excluded from the app tsconfig, like the other edge fns; if tsc reports errors inside it, STOP and report — do not edit tsconfig).

- [ ] **Step 4: Grep** — `grep -n "requireTier(req, \[\"pro\", \"business\"\], \"og_image\")\|function extractOgImage\|function fetchPexels" supabase/functions/og-image/index.ts` → all match.

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/og-image/index.ts
git commit -m "feat(selections): og-image edge function (scrape og:image + Pexels fallback)"
```

---

## Task 2: selectionsEngine — productUrl + image passthrough

**Files:** Modify `utils/selectionsEngine.ts`

- [ ] **Step 1: Add `productUrl` to the AI option schema**

Find `const aiOptionSchema = z.object({` (≈L260). Add a field before the closing `});`:
```ts
  productUrl:  z.string().default(''),
```

- [ ] **Step 2: Add `productUrl` + optional `imageUrl` to `CuratedOption`**

In `export interface CuratedOption {` (≈L285), add:
```ts
  productUrl: string;
  imageUrl?: string | null;
```

- [ ] **Step 3: Extend the curation prompt**

In `curateSelectionsAI`, inside the prompt's per-option bullet list (after the `supplier` bullet), add:
```
  • productUrl   — a real product or search-results page URL at the named supplier for THIS exact item (e.g. a Home Depot, Lowe's, Build.com, or Wayfair product/search URL). Best effort; prefer a direct product page.
```

- [ ] **Step 4: Map `productUrl` in the curate mapping**

In `curateSelectionsAI`'s `const options: CuratedOption[] = aiRes.data.options.map(...)`, add to the returned object:
```ts
    productUrl: o.productUrl || '',
```

- [ ] **Step 5: Persist `image_url` + `product_url` in `saveCuratedOptions`**

In `saveCuratedOptions`, the `rows = options.map(o => ({ ... }))` builder currently omits images. Add these two keys (next to `supplier`):
```ts
    image_url:   o.imageUrl   ?? null,
    product_url: o.productUrl ?? null,
```

- [ ] **Step 6: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "productUrl" utils/selectionsEngine.ts | head` → matches in schema, interface, prompt, mapping; `grep -n "image_url:   o.imageUrl" utils/selectionsEngine.ts` → match.
```bash
git add utils/selectionsEngine.ts
git commit -m "feat(selections): AI curation returns productUrl + persists option images"
```

---

## Task 3: `resolveSelectionImage` client wrapper

**Files:** Create `utils/ogImage.ts`

- [ ] **Step 1: Create the file**

```ts
import { supabase } from '@/lib/supabase';

/**
 * Resolve a product photo for a selection option. Tries og:image from `url`,
 * then a Pexels keyword search (`query`) server-side. Never throws — returns
 * null on any failure so curation/save can proceed photo-less.
 */
export async function resolveSelectionImage(opts: { url?: string; query?: string }): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ success: boolean; imageUrl: string | null }>(
      'og-image', { body: opts },
    );
    if (error || !data?.success) return null;
    return data.imageUrl ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "export async function resolveSelectionImage\|og-image" utils/ogImage.ts` → match.
```bash
git add utils/ogImage.ts
git commit -m "feat(selections): resolveSelectionImage client wrapper"
```

---

## Task 4: Selections screen — auto-resolve + thumbnail + manual paste

**Files:** Modify `app/selections.tsx`

- [ ] **Step 1: Imports**

- Add `Image` and `Platform` to the existing `react-native` import.
- Add `import { resolveSelectionImage } from '@/utils/ogImage';`
- Ensure `saveSelectionOption` is imported from `@/utils/selectionsEngine` (it is already imported alongside `saveCuratedOptions` — verify with `grep -n "saveSelectionOption" app/selections.tsx`; if missing, add it to that import).

- [ ] **Step 2: Auto-resolve images during curation**

Replace the body of `handleCurate` between the `curateSelectionsAI` call and `saveCuratedOptions` so each option gets an image first. Change:
```ts
      const { options } = await curateSelectionsAI({
        category: cat.category,
        styleBrief: cat.styleBrief,
        budget: cat.budget,
      });
      if (options.length === 0) {
        Alert.alert('No options', 'AI didn\'t return any options. Try a more specific style brief.');
        return;
      }
      const ok = await saveCuratedOptions(cat.id, options);
```
to:
```ts
      const { options } = await curateSelectionsAI({
        category: cat.category,
        styleBrief: cat.styleBrief,
        budget: cat.budget,
      });
      if (options.length === 0) {
        Alert.alert('No options', 'AI didn\'t return any options. Try a more specific style brief.');
        return;
      }
      // Resolve a product photo for each option (og:image from the AI's product
      // link, Pexels keyword fallback). Non-fatal — null just leaves it photo-less.
      const withImages = await Promise.all(options.map(async (o) => ({
        ...o,
        imageUrl: await resolveSelectionImage({ url: o.productUrl, query: `${o.brand} ${o.productName} ${cat.category}`.trim() }),
      })));
      const ok = await saveCuratedOptions(cat.id, withImages);
```

- [ ] **Step 3: `OptionRow` thumbnail**

In `OptionRow`, immediately after the opening `<TouchableOpacity ...>` and before `<View style={styles.optHead}>`, add:
```tsx
      {option.imageUrl ? (
        <Image source={{ uri: option.imageUrl }} style={styles.optImage} resizeMode="cover" />
      ) : null}
```

- [ ] **Step 4: Add the `optImage` style**

In the `makeStyles` `StyleSheet.create({...})`, add (match the file's `t`/theme token convention used by neighboring styles):
```ts
  optImage: { width: '100%', height: 130, borderRadius: 10, marginBottom: 8, backgroundColor: t.surfaceAlt },
```
(If the file's `makeStyles` parameter is named differently than `t`, use that name; if there is no `surfaceAlt`, use the nearest neutral surface token used elsewhere in this file.)

- [ ] **Step 5: Per-option "Set photo from link" (iOS) + the choose handler**

The `OptionRow` `onPress` currently chooses the option. Add a long-press to set/override the photo from a pasted link (iOS-primary; `Alert.prompt` is iOS-only — guard it). In `CategoryCard`, where `<OptionRow ... onPress={...} />` is rendered (search for `OptionRow`), add an `onSetPhoto` prop wired in the parent, and pass it through. Concretely:

In `OptionRow`'s props type add `onSetPhoto: () => void;`, and on the root `<TouchableOpacity>` add `onLongPress={onSetPhoto}`.

In the parent that renders `OptionRow` (inside `CategoryCard`’s `opts.map(o => ...)`), pass:
```tsx
onSetPhoto={() => onSetOptionPhoto(o, cat.category)}
```
Thread an `onSetOptionPhoto` callback from `SelectionsScreen` down through `CategoryCard` (add it to `CategoryCard`'s props), defined in `SelectionsScreen` as:
```ts
const onSetOptionPhoto = useCallback((option: SelectionOption, category: string) => {
  if (Platform.OS !== 'ios') {
    Alert.alert('Paste a link', 'Setting a photo from a link is available on iOS. On other platforms, re-curate to refresh photos.');
    return;
  }
  Alert.prompt('Set photo from link', 'Paste the product page URL — we\'ll pull its photo.', async (url?: string) => {
    if (!url || !url.trim()) return;
    const imageUrl = await resolveSelectionImage({ url: url.trim() });
    if (!imageUrl) { Alert.alert('No image found', 'Couldn\'t find a photo at that link.'); return; }
    await saveSelectionOption({ id: option.id, categoryId: option.categoryId, productName: option.productName, unitPrice: option.unitPrice, productUrl: url.trim(), imageUrl });
    void Haptics.selectionAsync();
    await refresh();
  }, 'plain-text');
}, [refresh]);
```
(Verify `option.categoryId` exists on `SelectionOption` — `grep -n "categoryId" types/index.ts | head`; the `SelectionOption` interface includes it. `Haptics` is already imported in this file; `refresh` is already in scope.)

- [ ] **Step 6: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "resolveSelectionImage\|optImage\|onSetOptionPhoto\|option.imageUrl" app/selections.tsx` → all match.
```bash
git add app/selections.tsx
git commit -m "feat(selections): auto-photo on curate + option thumbnail + paste-link override"
```

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean at the worktree root.
- [ ] `bun run lint` — no new errors on touched files.
- [ ] Whole-impl review: edge fn is safe (http-only fetch, body-scan cap, no key leak, requireTier Pro+), resolver never throws, curate still saves when images are null, thumbnail renders, manual paste guarded to iOS. OTA-safe; no migration.
- [ ] **Do NOT deploy/OTA here** — controller ships after review (deploy `og-image` + set optional `PEXELS_API_KEY` secret + `eas update`).

## Edge cases
- No `PEXELS_API_KEY` → fallback skipped; og:image + manual paste still work.
- AI returns a bad/404 URL → og:image null → Pexels fallback → else photo-less (non-fatal).
- Offline / fn error → `resolveSelectionImage` returns null; curation saves text-only.
- Non-iOS manual paste → friendly alert (re-curate to refresh).

## Out of scope (v1)
Paid search-by-name APIs; bulk re-scrape of existing options; CDN-proxying images; a full cross-platform paste modal (iOS `Alert.prompt` for v1).
