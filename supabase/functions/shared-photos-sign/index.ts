// shared-photos-sign/index.ts
//
// Public endpoint (no JWT — deploy with --no-verify-jwt; config.toml entry is
// w5-join-server's). Called by the /shared-photos page for a v2 photo-timeline
// link (utils/photoShareToken.ts) on every load, to turn the link's photo ids
// into fresh short-lived signed URLs. CONTRACT 11:
//
//   POST { projectId, photoIds }
//     → 200 { photos: [{ id, url, ts, d, tag }] }   (1 h signed URLs)
//     → 401 { error: 'denied', code: 'denied' }     (nothing shareable)
//
// WHY THIS EXISTS (wave 5, #62). A v1 link embedded each photo's render-time
// URI: on the iPhone that took the photos that was a file:// path forever (so
// every iPhone photo was left out as "not yet synced"), and everywhere else a
// signed URL that died 24 h later (so the homeowner's page went blank the next
// day). The v2 link carries ids; this function signs on demand.
//
// TRUST ROOT. The caller is anonymous; the (projectId, photoId) pair IS the
// capability — photo ids are random UUIDs the GC chose to put in the link. A
// photo is signed only when ALL of these hold, checked here with the service
// role (RLS does not apply):
//   • its row belongs to projectId;
//   • it was asked for;
//   • it is not drafted / recalled in the client portal (portal_state null or
//     status 'sent') — recalling a photo pulls it from links already sent;
//   • its stored value is a project-photos storage path of the canonical shape
//     `<row.user_id>/<projectId>/<file>`. That last check matters: an editor
//     can write any string into photos.uri, and without it a crafted row could
//     make this service-role signer hand out ANOTHER job's photo. The check is
//     the one storage-path rule (_shared/storagePath.ts requestStoragePath with
//     PROJECT_PHOTO_PATH, pinned to the row's user and the requested project),
//     run when the rows are filtered and again on the keys handed to Storage.
//     It used to be this function's own "three segments, the middle one is the
//     project" test, which `<user>/<project>/%2e%2e` passed.
// One answer for every refusal (unknown project, foreign ids, nothing stored)
// — 401 'denied' — so the endpoint is no oracle for which projects exist.
// `d` (the local day) is null: the server has no time zone for the job; the
// link carries the day computed on the GC's phone.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { rateLimitCount } from "../_shared/auth.ts";
import { clientIpFrom } from "../_shared/notifyGuards.ts";
import { PROJECT_PHOTO_PATH, requestStoragePath } from "../_shared/storagePath.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const DENIED = () => json({ error: "denied", code: "denied" }, 401);

/** Loads per IP per hour before a 429. A timeline page load is one call; a
 *  reload loop or a scraper walking ids is not. Fails OPEN on a limiter blip
 *  (the id check is the real gate; a homeowner must not be locked out). */
const IP_HOURLY_LIMIT = 300;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const PHOTO_BUCKET = "project-photos";

// ── pure:begin ── (scripts/validate-w5-scan-files-share.ts transpiles and
// runs this block under bun — keep it free of Deno / network references. Its
// one outside dependency is the storage-path rule imported above,
// requestStoragePath and PROJECT_PHOTO_PATH; the scripts that run the block
// import those two names from the same module.)
export const SHARE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Above the client's PHOTO_SHARE_MAX (30) with headroom; bounds the query. */
export const SHARE_MAX_IDS = 60;

export interface ShareSignRequest { projectId: string; photoIds: string[] }

/** The request, or null when it is not a well-formed one (→ 401, no detail). */
export function parseShareSignRequest(body: unknown): ShareSignRequest | null {
  const b = body as { projectId?: unknown; photoIds?: unknown } | null;
  if (!b || typeof b.projectId !== "string" || !SHARE_UUID_RE.test(b.projectId)) return null;
  if (!Array.isArray(b.photoIds) || b.photoIds.length === 0 || b.photoIds.length > SHARE_MAX_IDS) return null;
  const ids: string[] = [];
  for (const id of b.photoIds) {
    // Only UUIDs reach the query — they are spliced into a PostgREST in().
    // A non-UUID id (a demo seed) is skipped, not fatal to the whole link.
    if (typeof id !== "string" || !SHARE_UUID_RE.test(id)) continue;
    const lower = id.toLowerCase();
    if (!ids.includes(lower)) ids.push(lower);
  }
  if (ids.length === 0) return null;
  return { projectId: b.projectId.toLowerCase(), photoIds: ids };
}

/** A photos.uri value → the string to judge as a project-photos storage key,
 *  or '' (a device-local file:// capture, a seed/demo URL, another bucket).
 *  A Supabase object URL of the bucket is reduced to the key it names; a bare
 *  value is returned EXACTLY as it is stored — never trimmed, never stripped of
 *  a leading slash. The answer is a candidate, not a key: only what
 *  requestStoragePath returns for it is one. */
export function shareStoragePathOf(uri: unknown): string {
  if (typeof uri !== "string") return "";
  const kind = uri.trim();
  if (!kind) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(kind)) {
    if (!/^https?:\/\//i.test(kind)) return "";
    for (const marker of [
      `/storage/v1/object/public/${"project-photos"}/`,
      `/storage/v1/object/sign/${"project-photos"}/`,
      `/storage/v1/object/${"project-photos"}/`,
    ]) {
      const at = kind.indexOf(marker);
      if (at < 0) continue;
      const tail = kind.slice(at + marker.length).split("?")[0];
      try { return decodeURIComponent(tail); } catch { return tail; }
    }
    return "";
  }
  return uri;
}

export interface SharePhotoRow {
  id: string;
  user_id: string | null;
  project_id: string | null;
  uri: string | null;
  timestamp: string | null;
  tag: string | null;
  portal_state: { status?: unknown } | null;
}

/** `path` is the storage-path rule's answer; `owner` is the row's user, the
 *  first folder that answer was pinned to (never sent to the caller). */
export interface SignablePhoto { id: string; path: string; owner: string; ts: string | null; tag: string | null }

/** The rows this link may show, in the order the link asked for them. */
export function signableSharePhotos(rows: readonly SharePhotoRow[], req: ShareSignRequest): SignablePhoto[] {
  const asked = new Set(req.photoIds);
  const byId = new Map<string, SignablePhoto>();
  for (const r of rows) {
    const id = String(r.id ?? "").toLowerCase();
    if (!asked.has(id)) continue;
    if (String(r.project_id ?? "").toLowerCase() !== req.projectId) continue;
    const status = r.portal_state && typeof r.portal_state === "object" ? r.portal_state.status : undefined;
    if (r.portal_state && status !== "sent") continue; // drafted / recalled
    if (!r.user_id) continue;
    const owner = String(r.user_id).toLowerCase();
    // The one rule: exactly `<the row's user>/<the requested project>/<file>.<image ext>`.
    const path = requestStoragePath(shareStoragePathOf(r.uri), PROJECT_PHOTO_PATH, { 0: owner, 1: req.projectId });
    if (!path) continue;
    byId.set(id, { id: r.id, path, owner, ts: r.timestamp ?? null, tag: r.tag ?? null });
  }
  return req.photoIds.map((id) => byId.get(id)).filter((p): p is SignablePhoto => !!p);
}
// ── pure:end ──

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "svc not configured" }, 500);

  const ipHits = await rateLimitCount(`shared-photos-sign:ip:${clientIpFrom(req.headers)}`);
  if (ipHits > IP_HOURLY_LIMIT) return json({ error: "Too many requests. Please wait and try again.", code: "rate_limited" }, 429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const parsed = parseShareSignRequest(body);
  if (!parsed) return DENIED();

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: rows, error } = await svc
    .from("photos")
    .select("id, user_id, project_id, uri, timestamp, tag, portal_state")
    .eq("project_id", parsed.projectId)
    .in("id", parsed.photoIds);
  if (error) return json({ error: "lookup failed" }, 500);

  const ok = signableSharePhotos((rows ?? []) as SharePhotoRow[], parsed);
  if (ok.length === 0) return DENIED();

  // Storage is handed the rule's answer for each key (same shape, same pins),
  // never a string of the row's own.
  const keys: string[] = [];
  for (const p of ok) {
    const key = requestStoragePath(p.path, PROJECT_PHOTO_PATH, { 0: p.owner, 1: parsed.projectId });
    if (key) keys.push(key);
  }
  if (keys.length === 0) return DENIED();

  const { data: signed, error: signErr } = await svc.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(keys, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) return json({ error: "signing failed" }, 500);

  // A photo whose row synced before its bytes did has no object yet — it is
  // simply absent (the page says how many it could not show).
  const urlByPath = new Map<string, string>();
  for (const s of signed as { path?: string | null; signedUrl?: string | null; error?: string | null }[]) {
    if (s?.path && s.signedUrl && !s.error) urlByPath.set(s.path, s.signedUrl);
  }
  const photos = ok
    .filter((p) => urlByPath.has(p.path))
    .map((p) => ({ id: p.id, url: urlByPath.get(p.path) as string, ts: p.ts, d: null, tag: p.tag }));
  if (photos.length === 0) return DENIED();
  return json({ photos });
});
