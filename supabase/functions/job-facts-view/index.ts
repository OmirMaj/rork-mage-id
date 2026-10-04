// job-facts-view/index.ts — the public read behind https://mageid.app/facts/<code>
// (lane FACTS, M3).
//
// verify_jwt is OFF: a public, rate-limited read of one job facts link by its
// code. A homeowner, lender, buyer or inspector opens it with no account. The
// 12-character code (32-character alphabet, 2^60 values, crypto random,
// minted by public.job_fact_code() in 20261002161000_job_fact_links.sql) is
// the capability; the per-address hourly limit below bounds a guessing script.
// No AI and no tier gate.
//
//   GET ?code=XXXXXXXXXXXX
//     200 {live:true, job, sections, includeCoAmounts, facts, leftOut, publishedAt, photos}
//     400 {error:'bad_code'}   — format checked BEFORE any database read
//     404 {live:false}         — no such code OR a revoked one: ONE answer, so the
//                                endpoint is no oracle for which codes exist or
//                                were turned off (FOUNDER Q2 default)
//     405 | 429 {error:'rate_limited'} | 502 {error:'unavailable'}
//
// THE SINGLE CHOKE POINT. The token is checked HERE, on every request, against
// the row's revoked_at — the portal lesson (20260904100800, AUTH-F7/F8: expiry
// that was only cosmetic). Revoke is an update the owner's app awaits; the
// next request after it gets 404, and a 200 is cached for 30 s at most.
//
// PHOTOS. The payload carries photo ids only. While the link is live, each id
// is re-checked against `photos` with the SAME rules as shared-photos-sign
// (row on this job, not drafted / recalled in the portal, a canonical
// `<row.user_id>/<projectId>/<file>` storage path) and signed for 1 h. A
// revoked link signs nothing: the 404 returns before the photo query. The path
// check is the one storage-path rule (_shared/storagePath.ts requestStoragePath
// with PROJECT_PHOTO_PATH, pinned to the row's user and the link's project),
// run when the rows are filtered and again on the keys handed to Storage.
//
// WHAT IT RETURNS. Only the payload's allowlisted facts (built on the GC's
// phone by utils/jobFacts/buildJobFacts.ts) and the publish day. Never
// user_id, project_id, the row id, the code's owner or an email.
//
// RATE LIMIT. Keyed on cf-connecting-ip, else the LAST x-forwarded-for hop
// (_shared/notifyGuards.ts clientIpFrom). Fails OPEN when the limiter is down
// (-1): the code is the real gate, and a homeowner must not be locked out.
//
// last_viewed_at is stamped best-effort (never blocks or fails the read).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { rateLimitCount } from "../_shared/auth.ts";
import { clientIpFrom } from "../_shared/notifyGuards.ts";
import { PROJECT_PHOTO_PATH, requestStoragePath } from "../_shared/storagePath.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const IP_HOURLY_LIMIT = 120;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const PHOTO_BUCKET = "project-photos";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": status === 200 ? "public, max-age=30" : "no-store",
    },
  });
}

// ── pure:begin ── (scripts/validate-job-facts-view.ts transpiles and runs this
// block under bun — keep it free of Deno / network references. Its one outside
// dependency is the storage-path rule imported above, requestStoragePath and
// PROJECT_PHOTO_PATH; the scripts that run the block import those two names
// from the same module.)

/** Same alphabet and length as the table check and public.job_fact_code(). */
export const CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;

/** The ONLY columns read. project_id is read for the photo check and never
 *  returned; user_id and id are never read at all. */
export const LINK_COLUMNS = "project_id, payload, published_at, revoked_at";

/** The one answer for an unknown code AND a revoked one (no oracle). */
export const NOT_LIVE = Object.freeze({ live: false });

export const FACTS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The builder caps photos at 30; this bounds the query with headroom. */
export const FACTS_MAX_PHOTO_IDS = 60;

/** '?code=abcd-efgh-2345 ' → 'ABCDEFGH2345' when it is a well-formed code, else null. */
export function parseCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export interface LinkRow {
  project_id: string | null;
  payload: unknown;
  published_at: string | null;
  revoked_at: string | null;
}

/** null when the row is missing, revoked or unusable → the caller answers 404 NOT_LIVE. */
export function liveLink(row: LinkRow | null | undefined): { projectId: string; payload: Record<string, unknown>; publishedAt: string } | null {
  if (!row) return null;
  if (row.revoked_at != null) return null;
  if (typeof row.project_id !== "string" || !FACTS_UUID_RE.test(row.project_id)) return null;
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) return null;
  if (typeof row.published_at !== "string") return null;
  return { projectId: row.project_id.toLowerCase(), payload: row.payload as Record<string, unknown>, publishedAt: row.published_at };
}

/** The photo ids the payload asks for: UUIDs only (they reach a PostgREST
 *  in()), de-duplicated, in the payload's order, at most FACTS_MAX_PHOTO_IDS. */
export function payloadPhotoIds(payload: Record<string, unknown>): string[] {
  const facts = Array.isArray(payload.facts) ? payload.facts : [];
  const ids: string[] = [];
  for (const f of facts as { kind?: unknown; photo?: { id?: unknown } }[]) {
    if (!f || f.kind !== "photo" || !f.photo || typeof f.photo.id !== "string") continue;
    const id = f.photo.id.toLowerCase();
    if (!FACTS_UUID_RE.test(id) || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= FACTS_MAX_PHOTO_IDS) break;
  }
  return ids;
}

/** A photos.uri value → the string to judge as a project-photos storage key,
 *  or ''. Verbatim what shared-photos-sign's shareStoragePathOf does: an object
 *  URL of the bucket is reduced to the key it names, a bare value is returned
 *  exactly as it is stored (never trimmed or stripped). A candidate, not a key. */
export function factsStoragePathOf(uri: unknown): string {
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

export interface FactsPhotoRow {
  id: string;
  user_id: string | null;
  project_id: string | null;
  uri: string | null;
  timestamp: string | null;
  tag: string | null;
  portal_state: { status?: unknown } | null;
}

/** `path` is the storage-path rule's answer; `owner` is the row's user, the
 *  first folder that answer was pinned to (never returned to the caller). */
export interface FactsSignable { id: string; path: string; owner: string; ts: string | null; tag: string | null }

/** The rows this link may show, in the order the payload lists them. The same
 *  decision as shared-photos-sign's signableSharePhotos (validated side by side). */
export function signableFactsPhotos(rows: readonly FactsPhotoRow[], projectId: string, photoIds: readonly string[]): FactsSignable[] {
  const pid = projectId.toLowerCase();
  const asked = new Set(photoIds.map((x) => x.toLowerCase()));
  const byId = new Map<string, FactsSignable>();
  for (const r of rows) {
    const id = String(r.id ?? "").toLowerCase();
    if (!asked.has(id)) continue;
    if (String(r.project_id ?? "").toLowerCase() !== pid) continue;
    const status = r.portal_state && typeof r.portal_state === "object" ? r.portal_state.status : undefined;
    if (r.portal_state && status !== "sent") continue; // drafted / recalled
    if (!r.user_id) continue;
    const owner = String(r.user_id).toLowerCase();
    // The one rule: exactly `<the row's user>/<the link's project>/<file>.<image ext>`.
    const path = requestStoragePath(factsStoragePathOf(r.uri), PROJECT_PHOTO_PATH, { 0: owner, 1: pid });
    if (!path) continue;
    byId.set(id, { id: r.id, path, owner, ts: r.timestamp ?? null, tag: r.tag ?? null });
  }
  return photoIds.map((id) => byId.get(id.toLowerCase())).filter((p): p is FactsSignable => !!p);
}

/** The 200 body, field by field. Never user_id, project_id or the row id:
 *  only the payload's named parts, the publish day and the signed photos. */
export function viewBody(link: { payload: Record<string, unknown>; publishedAt: string }, photos: readonly { id: string; url: string }[]): Record<string, unknown> {
  const p = link.payload;
  const job = p.job && typeof p.job === "object" ? p.job as { name?: unknown; business?: unknown } : {};
  return {
    live: true,
    publishedAt: link.publishedAt,
    job: {
      name: typeof job.name === "string" ? job.name : "",
      business: typeof job.business === "string" ? job.business : null,
    },
    sections: Array.isArray(p.sections) ? p.sections.filter((s) => typeof s === "string") : [],
    includeCoAmounts: p.includeCoAmounts === true,
    facts: Array.isArray(p.facts) ? p.facts : [],
    leftOut: Array.isArray(p.leftOut) ? p.leftOut : [],
    photos: photos.map((x) => ({ id: x.id, url: x.url })),
  };
}
// ── pure:end ──

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  // The code check comes before ANY read (the rate limiter included).
  const code = parseCode(new URL(req.url).searchParams.get("code"));
  if (!code) return json({ error: "bad_code" }, 400);

  const hits = await rateLimitCount(`job-facts-view:${clientIpFrom(req.headers)}`);
  if (hits > IP_HOURLY_LIMIT) return json({ error: "rate_limited" }, 429);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "unavailable" }, 502);
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await svc
      .from("job_fact_links")
      .select(LINK_COLUMNS)
      .eq("code", code)
      .maybeSingle();
    if (error) {
      console.error("[job-facts-view] read failed", error.code ?? "", error.message ?? "");
      return json({ error: "unavailable" }, 502);
    }
    const link = liveLink(data as LinkRow | null);
    if (!link) return json(NOT_LIVE, 404);

    // Photos: re-checked and signed only while the link is live.
    let signedPhotos: { id: string; url: string }[] = [];
    const ids = payloadPhotoIds(link.payload);
    if (ids.length > 0) {
      const { data: rows, error: pErr } = await svc
        .from("photos")
        .select("id, user_id, project_id, uri, timestamp, tag, portal_state")
        .eq("project_id", link.projectId)
        .in("id", ids);
      if (!pErr) {
        const ok = signableFactsPhotos((rows ?? []) as FactsPhotoRow[], link.projectId, ids);
        // Storage is handed the rule's answer for each key (same shape, same
        // pins), never a string of the row's own.
        const keys: string[] = [];
        for (const p of ok) {
          const key = requestStoragePath(p.path, PROJECT_PHOTO_PATH, { 0: p.owner, 1: link.projectId });
          if (key) keys.push(key);
        }
        if (keys.length > 0) {
          const { data: signed, error: sErr } = await svc.storage
            .from(PHOTO_BUCKET)
            .createSignedUrls(keys, SIGNED_URL_TTL_SECONDS);
          if (!sErr && signed) {
            const urlByPath = new Map<string, string>();
            for (const s of signed as { path?: string | null; signedUrl?: string | null; error?: string | null }[]) {
              if (s?.path && s.signedUrl && !s.error) urlByPath.set(s.path, s.signedUrl);
            }
            signedPhotos = ok.filter((p) => urlByPath.has(p.path)).map((p) => ({ id: p.id, url: urlByPath.get(p.path) as string }));
          }
        }
      } else {
        console.error("[job-facts-view] photo lookup failed", pErr.code ?? "");
      }
    }

    // Best-effort: a failure never fails the read; never touches a revoked row.
    try {
      await svc.from("job_fact_links").update({ last_viewed_at: new Date().toISOString() })
        .eq("code", code).is("revoked_at", null);
    } catch { /* the view still answers */ }

    return json(viewBody(link, signedPhotos));
  } catch (err) {
    console.error("[job-facts-view] threw", err instanceof Error ? err.message : String(err));
    return json({ error: "unavailable" }, 502);
  }
});
