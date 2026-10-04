// seal-punch — the ONLY writer of a sealed final punch (lane SEAL).
//
// action 'seal'       The client accepted the final punch in person on the GC's
//                     phone. Re-check everything on the server (owner, sample,
//                     one seal per project, the server's own punch list, the
//                     signature), copy every after photo into the write-once
//                     punch-seals bucket with its SHA-256, build the manifest,
//                     hash it HERE, insert the row with the server's clock, then
//                     mark the items sealed. Returns the stored row: the app shows
//                     nothing as sealed before it has that row.
// action 'attach_pdf' The phone rendered the PDF from the stored row and uploaded
//                     it (upsert:false) to punch-seals/<uid>/<sealId>/record.pdf.
//                     Re-download it, re-hash, and only on a match store
//                     pdf_path + pdf_hash, once (seal-document's steps).
//
// Every refusal carries a `code` (PUNCH_SEAL_ERROR_CODES) the screen maps to a
// sentence. Logs never carry signature paths or names.
//
// Deployed at ship time (JWT required; config.toml [functions.seal-punch] verify_jwt = true):
//   supabase functions deploy seal-punch --project-ref nteoqhcswappxxjlpvap

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireTier } from '../_shared/auth.ts';
import { isSampleProjectName } from '../_shared/sampleFence.ts';
import {
  PUNCH_AFTER_PHOTO_PATH,
  punchSealPhotoPath,
  punchSealRecordPath,
  requestStoragePath,
} from '../_shared/storagePath.ts';
import {
  PUNCH_SEAL_MAX_ITEMS,
  buildPunchSealManifest,
  canonicalJson,
  checkPunchSealRequest,
  punchSealReadiness,
  sameItemSet,
  type PunchSealErrorCode,
  type PunchSealManifestItemInput,
} from '../_shared/punchSealManifest.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'punch-seals';
const PHOTO_BUCKET = 'project-photos';
const SEAL_COLUMNS = 'id,user_id,project_id,sealed_at,item_count,manifest,manifest_hash,signer_name,signer_role,method,signature_paths,consent_version,pdf_path,pdf_hash';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}
function fail(status: number, code: PunchSealErrorCode, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, code, error, ...extra }, status);
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function isHex64(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** A storage path we can hand to download(): not a URL, not a device file. */
function storagePathOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return s;
}

// deno-lint-ignore no-explicit-any
type Supa = SupabaseClient<any, 'public', any>;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail(405, 'bad_request', 'Method not allowed.');

  const t0 = Date.now();
  const log = (step: string, data?: Record<string, unknown>) => {
    console.log(`[seal-punch] +${Date.now() - t0}ms ${step}`, data ? JSON.stringify(data) : '');
  };

  try {
    // Every tier (founder Q3): a legal-grade record, not a paywall lever.
    const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'seal_punch');
    if (!auth.ok) return json(auth.body, auth.status);
    const uid = auth.userId;

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return fail(400, 'bad_request', 'The request could not be read.'); }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) return fail(500, 'server', 'The server is not set up to seal records.');
    const supa = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (body.action === 'seal') return await seal(supa, uid, body, log);
    if (body.action === 'attach_pdf') return await attachPdf(supa, uid, body, log);
    return fail(400, 'bad_request', 'Unknown action.');
  } catch (err) {
    console.error('[seal-punch] unhandled error', err instanceof Error ? err.message : 'unknown');
    return fail(500, 'server', 'The record could not be sealed. Try again.');
  }
});

async function seal(
  supa: Supa,
  uid: string,
  body: Record<string, unknown>,
  log: (s: string, d?: Record<string, unknown>) => void,
): Promise<Response> {
  const checked = checkPunchSealRequest(body);
  if (!checked.ok) return fail(checked.code === 'too_many' ? 413 : 400, checked.code, checked.message);
  const req = checked.value;

  // 1. The caller owns the project; a sample project is never sealed.
  const proj = await supa.from('projects').select('id,user_id,name').eq('id', req.projectId).maybeSingle();
  if (proj.error) return fail(500, 'server', 'The project could not be read. Try again.');
  if (!proj.data) return fail(404, 'not_found', 'That project was not found.');
  const project = proj.data as { id: string; user_id: string; name: string | null };
  if (project.user_id !== uid) return fail(403, 'forbidden', 'Only the project owner can seal its final punch.');
  if (isSampleProjectName(project.name)) return fail(409, 'sample', 'A sample project cannot be sealed.');
  log('owner_ok');

  // 2. One seal per project.
  const existing = await supa.from('punch_seals').select(SEAL_COLUMNS).eq('project_id', req.projectId).maybeSingle();
  if (existing.error) return fail(500, 'server', 'The record could not be read. Try again.');
  if (existing.data) return fail(409, 'already_sealed', 'This project’s final punch is already sealed.', { seal: existing.data });

  // 3. The server's own punch list decides.
  const rows = await supa
    .from('punch_items')
    .select('id,project_id,description,location,status,closed_at,list_type,photo_uri,after_photo_uri,plan_sheet_id,pin_x,pin_y,seal_id')
    .eq('project_id', req.projectId);
  if (rows.error) return fail(500, 'server', 'The punch list could not be read. Try again.');
  const items = (rows.data ?? []) as Record<string, unknown>[];
  const readiness = punchSealReadiness(items.map((r) => ({
    id: String(r.id),
    status: (r.status as string | null) ?? null,
    listType: (r.list_type as string | null) ?? null,
    afterPhotoUri: (r.after_photo_uri as string | null) ?? null,
  })));
  if (readiness.count > PUNCH_SEAL_MAX_ITEMS) {
    return fail(413, 'too_many', `A sealed record holds up to ${PUNCH_SEAL_MAX_ITEMS} punch items. This list has ${readiness.count}.`);
  }
  if (!readiness.ready) {
    return fail(409, 'not_ready', readiness.count === 0
      ? 'No punch list on file for this project.'
      : 'Some punch items are not closed with an after photo yet.', { blockers: readiness.blockers });
  }
  if (!sameItemSet(readiness.itemIds, req.itemIds)) {
    return fail(409, 'changed', 'The punch list changed since this screen loaded. Review it and sign again.');
  }
  log('ready', { count: readiness.count });

  // 4. Copy each after photo into the write-once bucket, hashed.
  const sealId = crypto.randomUUID();
  const byId = new Map(items.map((r) => [String(r.id), r]));
  const copied: string[] = [];
  const missing: string[] = [];
  const foreign: string[] = [];
  const manifestItems: PunchSealManifestItemInput[] = [];
  const removeCopies = async () => {
    if (copied.length > 0) await supa.storage.from(BUCKET).remove(copied);
  };
  for (const id of readiness.itemIds) {
    const r = byId.get(id)!;
    // after_photo_uri is a free-text column the app writes, and a project
    // editor can write it too — so it is request text as far as this function
    // is concerned. Security review 2026-10-04: the check was
    // `startsWith("<uid>/")` and the raw value went to download(); the storage
    // client splices the path into a URL unencoded, so "<uid>/../<other>/x.jpg"
    // (or %2e%2e) passed and the service role copied someone else's object into
    // this record. The key must now be EXACTLY what the app writes for an after
    // photo: `<owner>/<this project>/<file>.<image ext>`, nothing else.
    const src = requestStoragePath(r.after_photo_uri, PUNCH_AFTER_PHOTO_PATH, { 0: uid, 1: project.id });
    if (!src) { foreign.push(id); continue; }
    const dl = await supa.storage.from(PHOTO_BUCKET).download(src);
    if (dl.error || !dl.data) { missing.push(id); continue; }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    if (bytes.byteLength === 0) { missing.push(id); continue; }
    const sha = await sha256Hex(bytes);
    const dest = punchSealPhotoPath(uid, sealId, id);
    if (!dest) {
      await removeCopies();
      return fail(500, 'server', 'The photos could not be copied into the record. Try again.');
    }
    const up = await supa.storage.from(BUCKET).upload(dest, bytes, {
      contentType: dl.data.type || 'image/jpeg',
      upsert: false,
    });
    if (up.error) {
      await removeCopies();
      return fail(500, 'server', 'The photos could not be copied into the record. Try again.');
    }
    copied.push(dest);
    const before = storagePathOf(r.photo_uri);
    manifestItems.push({
      id,
      description: r.description as string | null,
      location: r.location as string | null,
      closedAt: r.closed_at as string | null,
      beforePhotoPath: before,
      afterPhotoPath: dest,
      afterPhotoSha256: sha,
      planSheetId: r.plan_sheet_id as string | null,
      pinX: r.pin_x == null ? null : Number(r.pin_x),
      pinY: r.pin_y == null ? null : Number(r.pin_y),
    });
  }
  if (foreign.length > 0) {
    await removeCopies();
    return fail(409, 'photo_foreign', 'Some after photos were taken on another account. Retake them on this phone.', { item_ids: foreign });
  }
  if (missing.length > 0) {
    await removeCopies();
    return fail(409, 'photo_uploading', 'Some after photos are still uploading from the phone. Wait for the upload, then sign again.', { item_ids: missing });
  }
  log('photos_copied', { count: copied.length });

  // 5. The manifest, hashed on the server, stamped with the server's clock.
  const sealedAt = new Date().toISOString();
  const signatureSha256 = await sha256Hex(new TextEncoder().encode(canonicalJson(req.signaturePaths)));
  const manifest = buildPunchSealManifest({
    sealId,
    projectId: req.projectId,
    projectName: project.name,
    sealedAt,
    items: manifestItems,
    signer: {
      name: req.signerName,
      role: req.signerRole,
      method: 'in_person',
      consentVersion: req.consentVersion,
      signatureSha256,
      strokeCount: req.signaturePaths.length,
    },
  });
  const manifestHash = await sha256Hex(new TextEncoder().encode(canonicalJson(manifest)));

  const ins = await supa.from('punch_seals').insert({
    id: sealId,
    user_id: uid,
    project_id: req.projectId,
    sealed_at: sealedAt,
    item_count: manifest.itemCount,
    manifest,
    manifest_hash: manifestHash,
    signer_name: req.signerName,
    signer_role: req.signerRole,
    method: 'in_person',
    signature_paths: req.signaturePaths,
    consent_version: req.consentVersion,
  }).select(SEAL_COLUMNS).single();
  if (ins.error || !ins.data) {
    await removeCopies();
    if ((ins.error as { code?: string } | null)?.code === '23505') {
      const again = await supa.from('punch_seals').select(SEAL_COLUMNS).eq('project_id', req.projectId).maybeSingle();
      return fail(409, 'already_sealed', 'This project’s final punch is already sealed.', { seal: again.data ?? null });
    }
    return fail(500, 'server', 'The record could not be sealed. Try again.');
  }
  log('sealed', { count: manifest.itemCount });

  // 6. Mark the items. The seal stands on its own if this fails: the app also
  //    blocks edits on every id the stored manifest names.
  //    Chunked: the id list rides in the query string.
  for (let i = 0; i < readiness.itemIds.length; i += 100) {
    const chunk = readiness.itemIds.slice(i, i + 100);
    // Guarded: only rows still closed and unsealed are marked, so a queued
    // reopen that landed after the readiness read is never pinned in place.
    const mark = await supa.from('punch_items').update({ seal_id: sealId })
      .eq('project_id', req.projectId).in('id', chunk).is('seal_id', null).eq('status', 'closed')
      .select('id');
    if (mark.error) { log('mark_failed', { from: i }); break; }
    const marked = (mark.data ?? []).length;
    if (marked !== chunk.length) log('mark_partial', { from: i, expected: chunk.length, marked });
  }

  return json({ ok: true, seal: ins.data });
}

async function attachPdf(
  supa: Supa,
  uid: string,
  body: Record<string, unknown>,
  log: (s: string, d?: Record<string, unknown>) => void,
): Promise<Response> {
  const { seal_id, storage_path, client_hash } = body;
  if (!isUuid(seal_id)) return fail(400, 'bad_request', 'The record id is missing.');
  if (!isHex64(client_hash)) return fail(400, 'bad_request', 'The PDF hash is missing.');
  // Defense in depth: the exact path for this seal, in the caller's folder —
  // rebuilt here from the verified caller and the record id, and that rebuilt
  // key (not the request's string) is what is downloaded and stored below.
  const recordKey = punchSealRecordPath(uid, seal_id);
  if (!recordKey || storage_path !== recordKey) {
    return fail(403, 'forbidden', 'That PDF is not stored under this record.');
  }

  const own = await supa.from('punch_seals').select(SEAL_COLUMNS).eq('id', seal_id).maybeSingle();
  if (own.error) return fail(500, 'server', 'The record could not be read. Try again.');
  if (!own.data) return fail(404, 'not_found', 'That record was not found.');
  const row = own.data as { user_id: string; pdf_path: string | null };
  if (row.user_id !== uid) return fail(403, 'forbidden', 'Only the project owner can store this PDF.');
  if (row.pdf_path) return fail(409, 'pdf_attached', 'A PDF copy is already stored for this record.', { seal: own.data });

  const dl = await supa.storage.from(BUCKET).download(recordKey);
  if (dl.error || !dl.data) return fail(404, 'not_found', 'The uploaded PDF was not found. Save it again.');
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  if (bytes.byteLength === 0) return fail(400, 'bad_request', 'The uploaded PDF is empty.');
  const serverHash = await sha256Hex(bytes);
  if (serverHash !== client_hash.toLowerCase()) {
    return fail(409, 'hash_mismatch', 'The stored PDF does not match the one this phone made. Nothing was attached.');
  }
  log('pdf_hash_verified');

  const upd = await supa
    .from('punch_seals')
    .update({ pdf_path: recordKey, pdf_hash: serverHash })
    .eq('id', seal_id)
    .eq('user_id', uid)
    .is('pdf_path', null)
    .select(SEAL_COLUMNS)
    .maybeSingle();
  if (upd.error) return fail(500, 'server', 'The PDF could not be attached. Try again.');
  if (!upd.data) return fail(409, 'pdf_attached', 'A PDF copy is already stored for this record.');
  log('pdf_attached');
  return json({ ok: true, seal: upd.data });
}
