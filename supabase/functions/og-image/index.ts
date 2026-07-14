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

// ── SSRF guard ──────────────────────────────────────────────────────────────
// og-image is an authed Pro+ endpoint that fetches a CLIENT-SUPPLIED URL server-
// side (product pages for the Selections feature), so it must allow arbitrary
// EXTERNAL hosts — a fixed allowlist (like _shared/urlGuard.ts) would break it.
// The old guard only denied literal private-IP strings, so a hostname that
// RESOLVES to an internal IP (e.g. 169-254-169-254.nip.io, or an attacker A
// record → 169.254.169.254) sailed through to Deno's fetch (DNS-rebinding SSRF
// to cloud metadata / internal services). Fix: resolve the host and reject if
// ANY A/AAAA record is private, and follow redirects MANUALLY so every hop is
// re-validated (an auto-follow redirect policy would chase a 30x to an internal host).
//
// Residual (accepted for this medium-sev endpoint): a TOCTOU/DNS-rebind gap
// remains because the resolver used for the check and the one fetch() uses to
// connect can differ. Fully closing it needs connect-by-validated-IP, which
// Deno fetch doesn't expose. This closes the practical nip.io + redirect vectors.

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return true;
  if (a === 0) return true;                          // "this" network
  if (a === 10) return true;                         // private
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return true;                    // loopback / unspecified
  if (h.startsWith("fe80")) return true;                          // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true;      // unique-local (ULA)
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4-mapped
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

// True if it is SAFE to fetch this hostname (resolves only to public IPs).
async function hostAllowed(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  if (isIpLiteral(h)) return !isPrivateIp(h);
  // Resolve and validate every A/AAAA record.
  const resolve = (Deno as { resolveDns?: unknown }).resolveDns;
  if (typeof resolve !== "function") {
    // Runtime doesn't expose DNS resolution — fall back to the literal denylist
    // (weaker, but better than deny-all which would break the whole feature).
    return !isPrivateIp(h);
  }
  const ips: string[] = [];
  for (const rt of ["A", "AAAA"] as const) {
    try { ips.push(...(await Deno.resolveDns(h, rt))); } catch { /* no records of this type */ }
  }
  if (ips.length === 0) return false;                 // can't verify → deny
  return ips.every((ip) => !isPrivateIp(ip));
}

async function fetchOgImage(startUrl: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let url = startUrl;
    let finalResp: Response | null = null;
    // Follow redirects manually so EVERY hop's host is SSRF-checked. Cap hops.
    for (let hop = 0; hop < 5; hop++) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { return null; }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      if (!(await hostAllowed(parsed.hostname))) return null;
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal: ctrl.signal,
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        await r.body?.cancel().catch(() => {});
        if (!loc) return null;
        url = new URL(loc, url).toString();           // resolve relative redirects
        continue;
      }
      finalResp = r;
      break;
    }
    if (!finalResp || !finalResp.ok) return null;
    const ct = finalResp.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("xml")) return null;
    const html = await finalResp.text();
    return extractOgImage(html, url);
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
