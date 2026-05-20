// seal-document — hash-verify-only edge fn for the S1.2 sealed-signed-
// contract flow. The GC's app renders the PDF on-device with expo-print,
// uploads it to secure-contracts/<userId>/<contractId>.pdf, computes a
// client-side SHA-256, then calls this fn. We re-download the bytes
// service-role, recompute the hash, and ONLY on match write
// signed_pdf_url + document_hash to project_contracts. This is the
// tamper-evidence step: any later byte-level change to the stored PDF
// breaks the stored hash.
//
// Deployed at ship time:
//   supabase functions deploy seal-document --no-verify-jwt --project-ref nteoqhcswappxxjlpvap

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireTier } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SealBody {
  contract_id?: unknown;
  storage_path?: unknown;
  client_hash?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function isHex64(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const t0 = Date.now();
  const log = (step: string, data?: Record<string, unknown>) => {
    console.log(`[seal-document] +${Date.now() - t0}ms ${step}`, data ? JSON.stringify(data) : '');
  };

  try {
    log('boot');

    // All tiers — legal-grade primitive, not a paywall lever.
    const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'seal_document');
    if (!auth.ok) return json(auth.body, auth.status);
    log('auth_ok', { userId: auth.userId, tier: auth.tier });

    let body: SealBody;
    try { body = await req.json(); }
    catch { return json({ ok: false, error: 'invalid JSON body' }, 400); }

    const { contract_id, storage_path, client_hash } = body;
    if (!isUuid(contract_id)) return json({ ok: false, error: 'contract_id must be a UUID' }, 400);
    if (typeof storage_path !== 'string' || storage_path.length === 0) {
      return json({ ok: false, error: 'storage_path is required' }, 400);
    }
    if (!isHex64(client_hash)) return json({ ok: false, error: 'client_hash must be 64 hex chars (SHA-256)' }, 400);

    // Defense-in-depth: the storage path must start with the caller's userId/
    // (the bucket RLS also enforces this; we re-check before any service-role
    // download to avoid leaking another user's bytes into a hash comparison).
    if (!storage_path.startsWith(`${auth.userId}/`)) {
      return json({ ok: false, error: 'storage_path is not owned by the caller' }, 403);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: 'server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }
    const supa = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 1. Verify ownership of the contract row (auth.userId === project_contracts.user_id).
    const ownRes = await supa
      .from('project_contracts')
      .select('id,user_id')
      .eq('id', contract_id)
      .maybeSingle();
    if (ownRes.error) return json({ ok: false, error: `lookup failed: ${ownRes.error.message}` }, 500);
    if (!ownRes.data) return json({ ok: false, error: 'contract not found' }, 404);
    if (ownRes.data.user_id !== auth.userId) return json({ ok: false, error: 'not your contract' }, 403);
    log('ownership_ok');

    // 2. Download the uploaded bytes (service-role bypasses Storage RLS).
    const dl = await supa.storage.from('secure-contracts').download(storage_path);
    if (dl.error || !dl.data) {
      return json({ ok: false, error: `download failed: ${dl.error?.message ?? 'no data'}` }, 404);
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    if (bytes.byteLength === 0) return json({ ok: false, error: 'uploaded file is empty' }, 400);
    log('downloaded', { bytes: bytes.byteLength });

    // 3. Server-side hash + compare.
    const serverHash = await sha256Hex(bytes);
    if (serverHash.toLowerCase() !== client_hash.toLowerCase()) {
      return json({ ok: false, error: 'hash mismatch — uploaded bytes do not match client_hash' }, 400);
    }
    log('hash_verified');

    // 4. Persist signed_pdf_url + document_hash on the contract row.
    const sealedAt = new Date().toISOString();
    const upd = await supa
      .from('project_contracts')
      .update({ signed_pdf_url: storage_path, document_hash: serverHash, updated_at: sealedAt })
      .eq('id', contract_id)
      .eq('user_id', auth.userId);
    if (upd.error) return json({ ok: false, error: `update failed: ${upd.error.message}` }, 500);
    log('persisted');

    return json({
      ok: true,
      signed_pdf_url: storage_path,
      document_hash: serverHash,
      sealed_at: sealedAt,
    });
  } catch (err) {
    console.error('[seal-document] unhandled error', err);
    return json({ ok: false, error: 'internal error' }, 500);
  }
});
