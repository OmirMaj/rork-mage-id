// scan-credential
//
// Gemini Vision extractor for worker credentials. Two kinds:
//   - 'government_id'  → { fullName, idType, idNumberFull, expiry, issuer } (DOB deliberately NOT extracted)
//   - 'certification'  → { certType, certNumber, issuer, issuedDate, expiresDate }
//
// Business-tier only. The server returns the extracted FIELDS ONLY — it never
// persists the image. Persistence + purge/mask happen client-side per the
// extract-then-purge policy. Modelled on analyze-photos (same auth / CORS /
// SSRF / metering / error shape).
//
// Secrets: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, aiUsageGet, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";
import { validateFetchableUrl } from "../_shared/urlGuard.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// B3 (review 2026-09-04): per-user hourly request ceiling + bounded upstream fetch.
const HOURLY_LIMIT = 30;
const VISION_TIMEOUT_MS = 120_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type ScanKind = 'government_id' | 'certification';
interface ScanRequest {
  kind: ScanKind;
  imageBase64?: string;
  imageUrl?: string;
  mimeType?: string;
}

const ID_PROMPT = `You are reading a US government-issued photo ID (driver's license, state ID, or passport). Extract the fields into strict JSON. Do NOT guess — leave a field as an empty string if it is not clearly legible.

Return a single JSON object:
  - fullName: the person's full name as printed.
  - idType: one of "drivers_license", "state_id", "passport", "other".
  - idNumberFull: the document/license number exactly as printed (letters + digits).
  - expiry: expiration date as YYYY-MM-DD if determinable, else "".
  - issuer: the issuing authority (state name for a license/state ID, country for a passport).

Do NOT extract or return date of birth — MAGE does not store it.
Return JSON only — no preamble. If the image is not a government ID, return { "fullName": "", "idType": "other", "idNumberFull": "", "expiry": "", "issuer": "" }.`;

const CERT_PROMPT = `You are reading a construction / trade CERTIFICATION card or certificate (OSHA 10/30, SST, CPR, First Aid, forklift, journeyman license, etc.). Extract the fields into strict JSON. Do NOT guess — leave a field empty if not clearly legible.

Return a single JSON object:
  - certType: the certification name/type as printed ("OSHA 30", "CPR/AED", "Journeyman Electrician").
  - certNumber: the certificate / card number if printed, else "".
  - issuer: the issuing organization/authority.
  - issuedDate: issue date as YYYY-MM-DD if determinable, else "".
  - expiresDate: expiration date as YYYY-MM-DD if determinable, else "".

Return JSON only — no preamble. If the image is not a certification, return { "certType": "", "certNumber": "", "issuer": "", "issuedDate": "", "expiresDate": "" }.`;

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const safeUrl = validateFetchableUrl(url);
  const r = await fetch(safeUrl);
  if (!r.ok) throw new Error(`Fetch image failed: ${r.status}`);
  const mimeType = r.headers.get('content-type') ?? 'image/jpeg';
  const buf = await r.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { data: btoa(binary), mimeType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  const auth = await requireTier(req, ['business'], 'scan_credential');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: ScanRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  if (body.kind !== 'government_id' && body.kind !== 'certification') {
    return jsonResponse({ success: false, error: 'kind must be "government_id" or "certification"' }, 400);
  }

  // Resolve the image: inline base64 (client camera/library file://) OR a URL
  // (SSRF-guarded). One image per call.
  let imageData: string;
  let mimeType: string;
  if (body.imageBase64) {
    const MAX_BYTES = 6 * 1024 * 1024;
    if (body.imageBase64.length > MAX_BYTES) {
      return jsonResponse({ success: false, error: 'Image too large. Capture at ~1200×1600.' }, 413);
    }
    imageData = body.imageBase64;
    mimeType = body.mimeType || 'image/jpeg';
  } else if (body.imageUrl) {
    try { validateFetchableUrl(body.imageUrl); }
    catch { return jsonResponse({ success: false, error: 'URL not allowed' }, 400); }
    try { const f = await fetchAsBase64(body.imageUrl); imageData = f.data; mimeType = f.mimeType; }
    catch { return jsonResponse({ success: false, error: 'Could not load the supplied image' }, 400); }
  } else {
    return jsonResponse({ success: false, error: 'imageBase64 or imageUrl required' }, 400);
  }

  // B3 (review 2026-09-04): per-user hourly request bucket, fail-CLOSED. Bounds
  // the precheck-then-charge window (N racing requests at cap-1) to at most
  // HOURLY_LIMIT model calls per user-hour whatever the client's concurrency;
  // master accounts included. rateLimitCount returns the POST-increment count,
  // so `n - 1 >= HOURLY_LIMIT` denies exactly the (HOURLY_LIMIT + 1)th request.
  const hourly = await rateLimitCount(`scan-credential:user:${auth.userId}`);
  if (hourly < 0) return jsonResponse({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable' }, 503);
  if (hourly - 1 >= HOURLY_LIMIT) return jsonResponse({ success: false, error: `Hourly limit reached (${HOURLY_LIMIT} per hour). Try again in an hour.`, code: 'hourly_limit' }, 429);
  // Monthly cap PRECHECK (audit AI-F8: charged after Gemini answers, below).
  // Never charge a unit for a missing, oversized (413), or unfetchable (400)
  // image where no scan runs. aiUsageGet fails CLOSED. Accepted window: N
  // racing requests at cap-1 can overshoot the cap by N-1, never more.
  const cap = MONTHLY_CAPS[auth.tier].scan_credential;
  const used = await aiUsageGet(auth.userId, 'scan_credential');
  if (used >= cap) {
    return jsonResponse({
      success: false,
      error: `Monthly credential-scan limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached', used, cap,
    }, 429);
  }

  console.log(`[scan-credential] kind=${body.kind} tier=${auth.tier}`);

  const prompt = body.kind === 'government_id' ? ID_PROMPT : CERT_PROMPT;
  const parts: Record<string, unknown>[] = [
    { text: prompt },
    { inline_data: { mime_type: mimeType, data: imageData } },
  ];

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VISION_TIMEOUT_MS);
  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 800 },
      }),
      signal: ac.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return jsonResponse({ success: false, error: 'The AI service timed out — please try again.', code: 'upstream_timeout' }, 504);
    }
    console.error('[scan-credential] Gemini network error:', (e as Error).message);
    return jsonResponse({ success: false, error: 'The AI service is unreachable — please try again.', code: 'upstream_error' }, 502);
  } finally {
    clearTimeout(timer);
  }
  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    console.error(`[scan-credential] Gemini ${geminiResp.status}: ${text.slice(0, 300)}`);
    return jsonResponse({ success: false, error: 'The AI service returned an error — please try again.', code: 'upstream_error' }, 502);
  }
  // The model answered — charge the unit now (AI-F8); a non-JSON answer below
  // is still a paid call.
  await aiUsageIncrement(auth.userId, 'scan_credential');

  // Guard the .json() itself: a 200 with a truncated/partial body throws here.
  // Return a CORS-carrying 502 rather than a bare, CORS-less 500.
  let j: Record<string, unknown>;
  try { j = await geminiResp.json(); }
  catch { return jsonResponse({ success: false, error: 'Gemini returned an unreadable response' }, 502); }
  const candidates = j?.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
  const raw = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: Record<string, unknown>;
  // Never echo `raw` back to the client — for a government_id scan it holds the
  // full extracted PII (name, ID number, DOB) and would leak into any client
  // error log/crash report. Diagnose server-side with a length-only marker.
  try { parsed = JSON.parse(raw) as Record<string, unknown>; }
  catch {
    console.log(`[scan-credential] non-JSON Gemini output (len=${raw.length})`);
    return jsonResponse({ success: false, error: 'Gemini returned non-JSON' }, 500);
  }

  if (body.kind === 'government_id') {
    const validTypes = ['drivers_license', 'state_id', 'passport', 'other'];
    const t = String(parsed.idType ?? 'other');
    const fields = {
      fullName: String(parsed.fullName ?? '').slice(0, 120),
      idType: validTypes.includes(t) ? t : 'other',
      idNumberFull: String(parsed.idNumberFull ?? '').slice(0, 40),
      expiry: String(parsed.expiry ?? ''),
      issuer: String(parsed.issuer ?? '').slice(0, 80),
    };
    return jsonResponse({ success: true, fields });
  }

  const fields = {
    certType: String(parsed.certType ?? '').slice(0, 120),
    certNumber: String(parsed.certNumber ?? '').slice(0, 60),
    issuer: String(parsed.issuer ?? '').slice(0, 120),
    issuedDate: String(parsed.issuedDate ?? ''),
    expiresDate: String(parsed.expiresDate ?? ''),
  };
  return jsonResponse({ success: true, fields });
});
