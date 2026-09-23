// signed-media-urls/index.ts — short-lived signed URLs for the two public
// readers of private buckets (wave 4, lane portal-server; #14, carry for plans).
//
// verify_jwt = false (supabase/config.toml): the homeowner and the architect
// hold no Supabase session. The function authenticates every call itself:
//
//   POST {kind:'portal_photos', portalId, token, photoIds}
//     → the portal access token through portal_project_for_token (the same
//       choke point portal_get_snapshot / portal-mark-viewed use: enabled,
//       token matches, link not expired). A passcode is never read — the
//       snapshot is served on the token alone, and checking one here would
//       make this function a passcode oracle (see core.parseMediaRequest).
//       A photo is signed only when it is (1) published in this portal's
//       stored snapshot (sections.photos / project.heroPhotoId), (2) a live
//       row in the portal's project, (3) still shared (portal_state null or
//       'sent' — a recall from any device takes effect on the next read), and
//       (4) stored under that project's folder.
//       ← {urls: {photoId: url}} (project-photos, TTL 3600)
//
//   POST {kind:'rfi_sheets', shareToken, paths}
//     → the RFI share token checked like get_rfi_by_token (an RFI whose
//       share_token it is); each path reduced to its plan-sheets key and
//       signed only when it is inside that RFI's project folder AND one of
//       the sheets the RFI row itself references (its attachments, or the
//       sheet of a drawing pin linked to it — what get_rfi_by_token returns).
//       ← {urls: {path: url}} (plan-sheets, TTL 3600) — keyed by the path the
//       page sent, so it can swap its own references.
//
// Any authentication failure is one answer, 401 {error:'denied'} — unknown
// portal, disabled, wrong token, expired, unknown share token
// look the same. An item that may not be signed is simply absent from `urls`.
// Nothing about a failure (PostgREST / Storage text) is echoed to the caller.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { rateLimitCount } from "../_shared/auth.ts";
import { clientIpFrom } from "../_shared/notifyGuards.ts";
import {
  MAX_ITEMS,
  PHOTO_BUCKET,
  PLAN_SHEET_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  isUuid,
  parseMediaRequest,
  photoSource,
  portalStateIsShared,
  publishedPhotoIds,
  rfiReferencedSheetKeys,
  rfiSheetKeysToSign,
} from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Page loads and refreshes, per caller address. The token is the gate; this
// only bounds a script hammering the signer. Fails OPEN when the limiter is
// unavailable (count < 0), like validate-portal-passcode.
const IP_HOURLY_LIMIT = 600;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const DENIED = () => json({ error: "denied" }, 401);

// deno-lint-ignore no-explicit-any
type Svc = SupabaseClient<any, "public", any>;

/** keys → signed URLs, batched; a key Storage refuses is just absent. */
async function signKeys(svc: Svc, bucket: string, keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(keys)];
  if (unique.length === 0) return out;
  const { data, error } = await svc.storage.from(bucket).createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error || !Array.isArray(data)) {
    console.error("[signed-media-urls] sign failed", bucket, error?.message ?? "no data");
    return out;
  }
  for (const row of data as { path?: string | null; signedUrl?: string | null; error?: string | null }[]) {
    if (row && row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

async function portalPhotos(
  svc: Svc,
  req: { portalId: string; token: string; photoIds: string[] },
): Promise<Response> {
  const { data: gate, error: gateErr } = await svc.rpc("portal_project_for_token", {
    p_portal_id: req.portalId,
    p_access_token: req.token,
  });
  if (gateErr) {
    console.error("[signed-media-urls] portal lookup failed", gateErr.message);
    return json({ error: "unavailable" }, 503);
  }
  const projectId = isUuid(gate) ? gate : null;
  if (!projectId) return DENIED();

  if (req.photoIds.length === 0) return json({ urls: {} });

  const { data: snapRow, error: snapErr } = await svc
    .from("portal_snapshots").select("snapshot").eq("portal_id", req.portalId).maybeSingle();
  if (snapErr) {
    console.error("[signed-media-urls] snapshot read failed", snapErr.message);
    return json({ error: "unavailable" }, 503);
  }
  const published = publishedPhotoIds((snapRow as { snapshot?: unknown } | null)?.snapshot);
  const wanted = req.photoIds.filter((id) => published.has(id));
  if (wanted.length === 0) return json({ urls: {} });

  const { data: rows, error: rowsErr } = await svc
    .from("photos").select("id, uri, portal_state, project_id")
    .eq("project_id", projectId).in("id", wanted);
  if (rowsErr) {
    console.error("[signed-media-urls] photo read failed", rowsErr.message);
    return json({ error: "unavailable" }, 503);
  }

  const urls: Record<string, string> = {};
  const toSign: { id: string; key: string }[] = [];
  for (const r of ((rows ?? []) as unknown) as { id: string; uri: unknown; portal_state: unknown; project_id: string }[]) {
    if (String(r.project_id).toLowerCase() !== projectId.toLowerCase()) continue;
    if (!portalStateIsShared(r.portal_state)) continue;
    const src = photoSource(r.uri, projectId);
    if (!src) continue;
    if ("pass" in src) urls[String(r.id).toLowerCase()] = src.pass;
    else toSign.push({ id: String(r.id).toLowerCase(), key: src.sign });
  }
  const signed = await signKeys(svc, PHOTO_BUCKET, toSign.map((t) => t.key));
  for (const t of toSign) {
    const u = signed.get(t.key);
    if (u) urls[t.id] = u;
  }
  return json({ urls });
}

/** SQL's `v between 0 and 1` for a PostgREST numeric: null / '' / NaN are out. */
const inUnit = (v: unknown): boolean => {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1;
};

async function rfiSheets(svc: Svc, req: { shareToken: string; paths: string[] }): Promise<Response> {
  // get_rfi_by_token's rule: the RFI whose share_token this is.
  const { data: rfi, error: rfiErr } = await svc
    .from("rfis").select("id, project_id, attachments").eq("share_token", req.shareToken).limit(1).maybeSingle();
  if (rfiErr) {
    console.error("[signed-media-urls] rfi lookup failed", rfiErr.message);
    return json({ error: "unavailable" }, 503);
  }
  const row = rfi as { id?: unknown; project_id?: unknown; attachments?: unknown } | null;
  const projectId = row?.project_id;
  const rfiId = row?.id;
  if (!isUuid(projectId) || !isUuid(rfiId)) return DENIED();

  // What the RFI row itself references (core.rfiReferencedSheetKeys): its
  // attachments plus the sheets under drawing pins linked to it — the same
  // pin rows get_rfi_by_token returns as pin_marks (x/y inside the sheet).
  // A key the caller names that is not one of these is never signed: the
  // share token proves access to THIS RFI's drawings, not the project folder.
  const { data: pins, error: pinErr } = await svc
    .from("drawing_pins").select("plan_sheet_id, x, y").eq("linked_rfi_id", rfiId);
  if (pinErr) {
    console.error("[signed-media-urls] pin read failed", pinErr.message);
    return json({ error: "unavailable" }, 503);
  }
  const sheetIds = [...new Set(((pins ?? []) as { plan_sheet_id?: unknown; x?: unknown; y?: unknown }[])
    .filter((p) => isUuid(p.plan_sheet_id) && inUnit(p.x) && inUnit(p.y))
    .map((p) => String(p.plan_sheet_id).toLowerCase()))];
  let pinSheetPaths: unknown[] = [];
  if (sheetIds.length > 0) {
    const { data: sheets, error: sheetErr } = await svc
      .from("plan_sheets").select("id, image_uri").in("id", sheetIds);
    if (sheetErr) {
      console.error("[signed-media-urls] sheet read failed", sheetErr.message);
      return json({ error: "unavailable" }, 503);
    }
    pinSheetPaths = ((sheets ?? []) as { image_uri?: unknown }[]).map((s) => s.image_uri);
  }
  const referenced = rfiReferencedSheetKeys(row?.attachments, pinSheetPaths, projectId);

  const byKey = rfiSheetKeysToSign(req.paths, projectId, referenced);
  const signed = await signKeys(svc, PLAN_SHEET_BUCKET, [...byKey.keys()]);
  const urls: Record<string, string> = {};
  for (const [key, asked] of byKey) {
    const u = signed.get(key);
    if (u) for (const p of asked) urls[p] = u;
  }
  return json({ urls });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "not_configured" }, 500);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const parsed = parseMediaRequest(body);
  if (!parsed) return json({ error: "bad_request", max: MAX_ITEMS }, 400);

  const ipHits = await rateLimitCount(`signed-media:ip:${clientIpFrom(req.headers)}`);
  if (ipHits > IP_HOURLY_LIMIT) return json({ error: "rate_limited" }, 429);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    return parsed.kind === "portal_photos" ? await portalPhotos(svc, parsed) : await rfiSheets(svc, parsed);
  } catch (e) {
    console.error("[signed-media-urls] failed", e instanceof Error ? e.message : String(e));
    return json({ error: "unavailable" }, 503);
  }
});
