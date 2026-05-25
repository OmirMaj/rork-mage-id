import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";

const PEXELS_API_KEY = Deno.env.get("PEXELS_API_KEY") || "";
const MAX_HTML_SCAN = 200_000;
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
