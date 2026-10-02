// portal-message-files/index.ts — photos and PDFs in the homeowner's portal
// thread (track MSG, lane MSGDATA).
//
// verify_jwt is OFF (supabase/config.toml): the homeowner holds no Supabase
// session, only the portal link. The function authenticates every call itself
// with the portal access token, through portal_project_for_token — the same
// choke point portal_get_messages / signed-media-urls use (portal enabled,
// token matches, link not expired). The token's project is the ONLY project
// this call can touch. A passcode is never read: the thread is served on the
// token alone, and checking one here would make this a passcode oracle (see
// core.parsePortalFilesRequest).
//
//   POST {action:'upload', portalId, token, messageId, file:{id,name,mime,size}}
//     → a signed upload URL for exactly <project>/<message>/<file>.<ext>
//       (Storage's fixed 2 h, one key, no upsert). Refused when the message
//       already exists (a sent message's files never change).
//   POST {action:'send', portalId, token, messageId, body, authorName, files}
//     → lists the message folder, checks every named file is there with the
//       declared size and type, reads its first 16 bytes and refuses (and
//       removes) a file that is not what it says, then writes the client row
//       with its attachments. The table trigger checks the same again.
//       A re-send after a lost answer is answered {ok:true, duplicate:true}.
//   POST {action:'urls', portalId, token, messageIds}
//     → {urls:{attachmentId:url}} for files of messages IN THIS PORTAL whose
//       stored path is exactly the key core.pathFor gives (TTL 300 s).
//   POST {action:'download', portalId, token, messageId, attachmentId}
//     → one signed URL that downloads under the cleaned file name (TTL 120 s).
//
// Rate limits (rateLimitCount, hourly): per caller address 600 FIRST, before
// the token is checked; per portal (upload 120, send 60) only AFTER the token
// passed, so a bogus token cannot burn a victim portal's budget. Every limit
// fails OPEN when the limiter itself is unavailable (count -1), like
// signed-media-urls: the token is the gate, the limits only bound a script.
//
// Any authentication failure is one answer, 401 {error:'denied'}. Nothing from
// Postgres or Storage is echoed to the caller; console.error carries it.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { rateLimitCount } from "../_shared/auth.ts";
import { clientIpFrom } from "../_shared/notifyGuards.ts";
import {
  DOWNLOAD_TTL_SECONDS,
  MESSAGE_FILES_BUCKET,
  SNIFF_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
  URL_TTL_SECONDS,
  cleanAuthor,
  cleanBody,
  folderFor,
  isAlreadyExists,
  isUuid,
  mapTriggerRefusal,
  parsePortalFilesRequest,
  pathFor,
  rowsFor,
  signable,
  sniffMatches,
  verifyListing,
  type FilesRequest,
} from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const IP_HOURLY_LIMIT = 600;
const PORTAL_UPLOAD_HOURLY_LIMIT = 120;
const PORTAL_SEND_HOURLY_LIMIT = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const DENIED = () => json({ error: "denied" }, 401);
const UNAVAILABLE = () => json({ error: "unavailable" }, 503);
const RATE_LIMITED = () => json({ error: "rate_limited" }, 429);

// deno-lint-ignore no-explicit-any
type Svc = SupabaseClient<any, "public", any>;
type Req<A extends FilesRequest["action"]> = Extract<FilesRequest, { action: A }>;

/** Hourly count over the limit? -1 (limiter unavailable) fails open. */
async function over(scope: string, limit: number): Promise<boolean> {
  const n = await rateLimitCount(scope);
  return n > limit;
}

/** Remove objects 'send' refused, so a corrected file can take the key. Best effort. */
async function removeKeys(svc: Svc, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { error } = await svc.storage.from(MESSAGE_FILES_BUCKET).remove(keys);
  if (error) console.error("[portal-message-files] remove failed", error.message);
}

async function upload(svc: Svc, r: Req<"upload">, projectId: string): Promise<Response> {
  const { data: existing, error: exErr } = await svc
    .from("portal_messages").select("id").eq("id", r.messageId).maybeSingle();
  if (exErr) {
    console.error("[portal-message-files] upload: message lookup failed", exErr.message);
    return UNAVAILABLE();
  }
  if (existing) return json({ error: "message_exists" }, 409);

  const key = pathFor(projectId, r.messageId, r.file.id, r.file.mime);
  if (!key) return json({ error: "bad_request" }, 400);
  const { data, error } = await svc.storage.from(MESSAGE_FILES_BUCKET).createSignedUploadUrl(key);
  if (error || !data?.signedUrl) {
    if (isAlreadyExists(error)) return json({ error: "exists" }, 409);
    console.error("[portal-message-files] upload: sign failed", error?.message ?? "no url");
    return UNAVAILABLE();
  }
  return json({ uploadUrl: data.signedUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });
}

/** The first 16 bytes of one stored object, or null when they cannot be read. */
async function headOf(svc: Svc, key: string): Promise<Uint8Array | null> {
  const { data, error } = await svc.storage.from(MESSAGE_FILES_BUCKET).createSignedUrl(key, SNIFF_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("[portal-message-files] send: sniff sign failed", error?.message ?? "no url");
    return null;
  }
  const res = await fetch(data.signedUrl, { headers: { Range: "bytes=0-15" } });
  if (!res.ok) {
    console.error("[portal-message-files] send: sniff read failed", res.status);
    await res.body?.cancel();
    return null;
  }
  return new Uint8Array(await res.arrayBuffer()).slice(0, 16);
}

async function send(svc: Svc, r: Req<"send">, projectId: string): Promise<Response> {
  const folder = folderFor(projectId, r.messageId);
  if (!folder) return json({ error: "bad_request" }, 400);
  // 100, not 10: files the page uploaded and then removed before sending stay
  // in the folder (no DELETE policy), and a short listing must not hide one
  // that is being sent.
  const { data: listing, error: lsErr } = await svc.storage.from(MESSAGE_FILES_BUCKET).list(folder, { limit: 100 });
  if (lsErr) {
    console.error("[portal-message-files] send: list failed", lsErr.message);
    return UNAVAILABLE();
  }
  const keyOf = (id: string): string => {
    const f = r.files.find((x) => x.id === id);
    return (f && pathFor(projectId, r.messageId, f.id, f.mime)) || "";
  };
  const { missing, mismatched } = verifyListingOf(listing, r.files);
  if (missing.length > 0) return json({ error: "not_uploaded", ids: missing }, 422);
  if (mismatched.length > 0) {
    await removeKeys(svc, mismatched.map(keyOf).filter(Boolean));
    return json({ error: "file_rejected", ids: mismatched }, 422);
  }

  // Sniff every file BEFORE the row is written: a .pdf that is not a PDF is
  // removed and refused, so the GC never opens a mislabelled upload.
  const rejected: string[] = [];
  for (const f of r.files) {
    const key = pathFor(projectId, r.messageId, f.id, f.mime);
    if (!key) { rejected.push(f.id); continue; }
    const head = await headOf(svc, key);
    if (!head) return UNAVAILABLE();
    if (!sniffMatches(head, f.mime)) rejected.push(f.id);
  }
  if (rejected.length > 0) {
    await removeKeys(svc, rejected.map(keyOf).filter(Boolean));
    return json({ error: "file_rejected", ids: rejected }, 422);
  }

  const { error: insErr } = await svc.from("portal_messages").insert({
    id: r.messageId,
    portal_id: r.portalId,
    project_id: projectId,
    author_type: "client",
    author_name: cleanAuthor(r.authorName) || "Client",
    body: cleanBody(r.body),
    attachments: rowsFor(projectId, r.messageId, r.files),
    read_by_client: true,
    read_by_gc: false,
  });
  if (!insErr) return json({ ok: true, id: r.messageId });

  if (insErr.code === "23505") {
    // A re-send after a lost answer: the row is there. Say so only when it is
    // this portal's own message.
    const { data: prior, error: priorErr } = await svc
      .from("portal_messages").select("portal_id").eq("id", r.messageId).maybeSingle();
    if (priorErr) {
      console.error("[portal-message-files] send: duplicate lookup failed", priorErr.message);
      return UNAVAILABLE();
    }
    if ((prior as { portal_id?: unknown } | null)?.portal_id === r.portalId) {
      return json({ ok: true, id: r.messageId, duplicate: true });
    }
    return json({ error: "refused" }, 422);
  }
  const refusal = mapTriggerRefusal(insErr.message);
  console.error("[portal-message-files] send: insert failed", insErr.code, insErr.message);
  if (refusal) return json({ error: refusal }, 422);
  return UNAVAILABLE();
}

/** core.verifyListing over Storage's list() answer. */
function verifyListingOf(listing: unknown, files: { id: string; mime: string; size: number }[]) {
  const rows = (Array.isArray(listing) ? listing : []) as { name: string; metadata?: { size?: number; mimetype?: string } | null }[];
  return verifyListing(rows, files);
}

type MsgRow = { id: string; project_id: string | null; attachments: unknown };

async function urls(svc: Svc, r: Req<"urls">, projectId: string): Promise<Response> {
  // r.messageIds are parser-validated uuids: PostgREST's .in() splices them
  // into the filter unescaped (audit 2026-09), so nothing else may reach it.
  const { data: rows, error } = await svc
    .from("portal_messages").select("id, project_id, attachments")
    .eq("portal_id", r.portalId).in("id", r.messageIds);
  if (error) {
    console.error("[portal-message-files] urls: read failed", error.message);
    return UNAVAILABLE();
  }
  const items = signable((rows ?? []) as MsgRow[], projectId);
  const out: Record<string, string> = {};
  if (items.length > 0) {
    const keys = [...new Set(items.map((i) => i.key))];
    const { data, error: signErr } = await svc.storage.from(MESSAGE_FILES_BUCKET).createSignedUrls(keys, URL_TTL_SECONDS);
    if (signErr || !Array.isArray(data)) {
      console.error("[portal-message-files] urls: sign failed", signErr?.message ?? "no data");
      return UNAVAILABLE();
    }
    const byKey = new Map<string, string>();
    for (const s of data as { path?: string | null; signedUrl?: string | null; error?: string | null }[]) {
      if (s && s.path && s.signedUrl && !s.error) byKey.set(s.path, s.signedUrl);
    }
    for (const i of items) {
      const u = byKey.get(i.key);
      if (u) out[i.attachmentId] = u;
    }
  }
  return json({ urls: out, expiresInSeconds: URL_TTL_SECONDS });
}

async function download(svc: Svc, r: Req<"download">, projectId: string): Promise<Response> {
  const { data: row, error } = await svc
    .from("portal_messages").select("id, project_id, attachments")
    .eq("portal_id", r.portalId).eq("id", r.messageId).maybeSingle();
  if (error) {
    console.error("[portal-message-files] download: read failed", error.message);
    return UNAVAILABLE();
  }
  const item = signable(row ? [row as MsgRow] : [], projectId).find((i) => i.attachmentId === r.attachmentId);
  if (!item) return json({ error: "not_found" }, 404);
  const { data, error: signErr } = await svc.storage.from(MESSAGE_FILES_BUCKET)
    .createSignedUrl(item.key, DOWNLOAD_TTL_SECONDS, { download: item.name });
  if (signErr || !data?.signedUrl) {
    console.error("[portal-message-files] download: sign failed", signErr?.message ?? "no url");
    return UNAVAILABLE();
  }
  return json({ url: data.signedUrl, expiresInSeconds: DOWNLOAD_TTL_SECONDS });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "not_configured" }, 500);

  // Per caller address, FIRST: before the body is parsed or the token checked.
  if (await over(`portal-files:ip:${clientIpFrom(req.headers)}`, IP_HOURLY_LIMIT)) return RATE_LIMITED();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const parsed = parsePortalFilesRequest(body);
  if (!parsed.ok) return json(parsed.reason ? { error: "bad_request", reason: parsed.reason } : { error: "bad_request" }, 400);
  const r = parsed.req;

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    const { data: gate, error: gateErr } = await svc.rpc("portal_project_for_token", {
      p_portal_id: r.portalId,
      p_access_token: r.token,
    });
    if (gateErr) {
      console.error("[portal-message-files] portal lookup failed", gateErr.message);
      return UNAVAILABLE();
    }
    if (!isUuid(gate)) return DENIED();
    const projectId = gate.toLowerCase();

    // Per portal, only now that the token has passed.
    if (r.action === "upload") {
      if (await over(`portal-files:upload:${r.portalId}`, PORTAL_UPLOAD_HOURLY_LIMIT)) return RATE_LIMITED();
      return await upload(svc, r, projectId);
    }
    if (r.action === "send") {
      if (await over(`portal-files:send:${r.portalId}`, PORTAL_SEND_HOURLY_LIMIT)) return RATE_LIMITED();
      return await send(svc, r, projectId);
    }
    if (r.action === "urls") return await urls(svc, r, projectId);
    return await download(svc, r, projectId);
  } catch (e) {
    console.error("[portal-message-files] failed", r.action, e instanceof Error ? e.message : String(e));
    return UNAVAILABLE();
  }
});
