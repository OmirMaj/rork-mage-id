// urlGuard
//
// SSRF defense for the vision functions. analyze-drawings / analyze-photos /
// analyze-takeoff / compare-drawings all fetch client-supplied image URLs
// server-side and forward the bytes to Gemini/Claude. Without validation any
// paid account could point those URLs at internal services or the cloud
// metadata endpoint (169.254.169.254) and exfiltrate the rendered bytes.
//
// Policy: the app only ever generates these URLs from its OWN Supabase
// project storage — `getPublicUrl(...)` / `createSignedUrl(...)` on the
// project host (== the host of SUPABASE_URL, e.g.
// `nteoqhcswappxxjlpvap.supabase.co`). So we require:
//   - scheme https
//   - host exactly equal to the project's Supabase host
//   - and, defensively, reject any private / loopback / link-local /
//     metadata IP literal or internal hostname
//
// Restricting to the project's own host (rather than all of *.supabase.co)
// also closes the redirect-to-internal vector: an attacker cannot make our
// own storage 30x-redirect to an internal address, whereas a foreign
// *.supabase.co project they control could. Callers surface a GENERIC 400
// on rejection — never echo the offending URL or an upstream status.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
// Fallback matches the project ref hard-coded in lib/supabase.ts so the guard
// still functions if SUPABASE_URL is somehow unset in the runtime.
const FALLBACK_HOST = "nteoqhcswappxxjlpvap.supabase.co";

export class UrlValidationError extends Error {
  constructor() {
    super("Invalid or disallowed image URL.");
    this.name = "UrlValidationError";
  }
}

function envHost(): string {
  try {
    return SUPABASE_URL ? new URL(SUPABASE_URL).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** IPv4 literals inside private / loopback / link-local / CGNAT / metadata
 *  ranges. 169.254.0.0/16 covers the cloud metadata endpoint. */
function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return true;
  if (a === 0) return true;
  if (a === 10) return true;                       // private
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;         // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Reject obviously-internal hosts regardless of the allowlist. Belt-and-
 *  suspenders: the exact-host allowlist below already rejects all of these,
 *  but this makes the intent explicit and guards future callers. */
function isDisallowedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  // Any IPv6 literal (URL.hostname wraps these in brackets). Our storage
  // host is never a raw IP, so reject the whole class.
  if (h.startsWith("[")) return true;
  if (isPrivateIpv4(h)) return true;
  return false;
}

/**
 * Validate a client-supplied fetchable image URL against the SSRF policy.
 * Returns the normalized URL string on success; throws UrlValidationError
 * on any violation. Callers must catch and return a GENERIC 400 that does
 * not echo the URL.
 */
export function validateFetchableUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) throw new UrlValidationError();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UrlValidationError();
  }
  if (u.protocol !== "https:") throw new UrlValidationError();
  const host = u.hostname.toLowerCase();
  if (isDisallowedHost(host)) throw new UrlValidationError();
  const allowed = new Set([envHost(), FALLBACK_HOST].filter(Boolean));
  if (!allowed.has(host)) throw new UrlValidationError();
  return u.toString();
}
