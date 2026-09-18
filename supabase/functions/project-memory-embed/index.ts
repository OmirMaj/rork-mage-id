// project-memory-embed
//
// Project Memory v2 indexer. The app pushes a project's records (RFIs, daily
// reports, change orders, submittals, punch items — already extracted into
// MemoryDocs client-side) here; we embed each with Gemini and upsert into
// memory_embeddings so project-memory-search can do cosine ANN over them.
//
// Client-driven sync (vs. DB triggers) keeps v1 simple: the Project Memory
// screen calls this best-effort on open, so the index tracks the records the
// user actually has. Idempotent via upsert on (user_id, doc_id).
//
// INCREMENTAL (audit round 2, #23). Two request shapes:
//   { projectId, action: 'manifest', manifest: [{doc_id, hash}], scopePrefixes, prune }
//       → which docs are missing/changed (`stale`), and — when `prune` — deletes
//         rows under `scopePrefixes` whose record no longer exists. No Gemini
//         call, so no charge; it still spends one hourly-bucket slot.
//   { projectId, docs: [{doc_id, source, ref, content, content_hash?}] }
//       → embed + upsert (≤ MAX_DOCS per call; the client batches), storing the
//         hash so the next manifest can tell the row is current.
// Before this, the client re-sent only the FIRST 250 records every time: new
// submittals past record 250 were never embedded, early rows kept their old
// text, and deleted records stayed citable.
//
// Deploy:  supabase functions deploy project-memory-embed
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageGet, aiUsageIncrement, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";
import { geminiEmbed, toVectorLiteral } from "../_shared/embeddings.ts";
import { diffIndex, orphanedChunks, type IndexRow, type ManifestEntry } from "./indexDiff.ts";

// Burst / shared-key ceiling: at most this many embed+search calls per user per
// hour. A normal user opens the Project Memory screen a handful of times a day;
// this only bites a scripted loop that would otherwise drain the shared
// GEMINI_API_KEY's quota and degrade AI for every tenant.
const PM_HOURLY_LIMIT = 90;

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

interface InDoc { doc_id: string; source: string; ref: string; content: string; content_hash?: string }
interface EmbedRequest {
  projectId?: string;
  docs?: InDoc[];
  action?: "manifest";
  manifest?: ManifestEntry[];
  scopePrefixes?: string[];
  prune?: boolean;
}

const MAX_DOCS = 250;
/** A manifest carries ids + hashes only; a whole commercial job fits well under this. */
const MAX_MANIFEST = 20000;

async function rpc(name: string, args: Record<string, unknown>): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
}

/** (doc_id, content_hash) under the given prefixes, or null when the RPC is not
 *  there yet (migration 20260917170000 not applied) or failed. */
async function readIndexState(userId: string, projectId: string, prefixes: string[]): Promise<IndexRow[] | null> {
  if (prefixes.length === 0) return [];
  const r = await rpc("project_memory_index_state", { p_user_id: userId, p_project_id: projectId, p_prefixes: prefixes });
  if (!r.ok) {
    console.error("[project-memory-embed] index state failed:", r.status, (await r.text().catch(() => "")).slice(0, 200));
    return null;
  }
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows as IndexRow[] : null;
}

async function deleteDocs(userId: string, projectId: string, docIds: string[]): Promise<number> {
  if (docIds.length === 0) return 0;
  const r = await rpc("delete_project_memory_docs", { p_user_id: userId, p_project_id: projectId, p_doc_ids: docIds });
  if (!r.ok) {
    console.error("[project-memory-embed] prune failed:", r.status, (await r.text().catch(() => "")).slice(0, 200));
    return 0;
  }
  const n = await r.json().catch(() => 0);
  return typeof n === "number" ? n : 0;
}

function cleanPrefixes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 80))].slice(0, 20);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Use POST" }, 405);

  const auth = await requireTier(req, ["pro", "business", "enterprise"], "project_memory");
  if (!auth.ok) return json(auth.body, auth.status);

  let body: EmbedRequest;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const projectId = (body.projectId || "").trim();

  // ── Manifest: diff (+ optional prune). No embedding spend, so no cap charge;
  //    the hourly bucket still applies so it can't be scripted into a DB load.
  if (body.action === "manifest") {
    if (!projectId || !Array.isArray(body.manifest)) return json({ success: false, error: "Missing projectId or manifest" }, 400);
    const manifest = body.manifest.slice(0, MAX_MANIFEST);
    const rl = await rateLimitCount(`pm:${auth.userId}`);
    if (rl < 0) return json({ success: false, error: "Rate limiter unavailable — please try again in a moment.", code: "rate_limiter_unavailable" }, 503);
    if (rl - 1 >= PM_HOURLY_LIMIT) {
      return json({ success: false, error: "Too many Project Memory requests — please wait a moment and retry.", code: "rate_limited" }, 429);
    }
    // A prune needs a named scope: without one this surface could delete rows
    // another surface wrote (plan sheets, the Home Passport).
    const scope = cleanPrefixes(body.scopePrefixes);
    const prune = body.prune === true && scope.length > 0;
    // Diff-only callers with no scope read exactly their own ids.
    const readPrefixes = scope.length > 0 ? scope : [...new Set(manifest.map(m => String(m?.doc_id ?? "")).filter(Boolean))].slice(0, MAX_MANIFEST);
    const rows = await readIndexState(auth.userId, projectId, readPrefixes);
    if (!rows) return json({ success: false, error: "Index state unavailable", code: "index_state_unavailable" }, 503);
    // `scope` goes in too: the whole-type guard needs to know which record
    // types this caller claims to hold, so a collection that has not hydrated
    // yet cannot be read as "the user deleted all of them".
    const diff = diffIndex(manifest, rows, { prune, scopePrefixes: scope });
    const pruned = await deleteDocs(auth.userId, projectId, diff.prune);
    return json({
      success: true,
      stale: diff.stale,
      indexed: diff.fresh.length,
      total: diff.stale.length + diff.fresh.length,
      pruned,
      pruneRefused: diff.pruneRefused,
    });
  }

  const docs = (body.docs || []).filter(d => d && d.doc_id && d.content).slice(0, MAX_DOCS);
  if (!projectId || docs.length === 0) return json({ success: false, error: "Missing projectId or docs" }, 400);

  // Cost ceiling (audit: this + project-memory-search were the ONLY paid-AI
  // endpoints with no server-side cap or rate limit). Precheck BEFORE spending on
  // Gemini. Metered PER DOC (docs.length) — one embed call batches up to 250 docs,
  // so per-call metering under-counted the real Gemini cost by up to ~250×.
  const cap = MONTHLY_CAPS[auth.tier]?.project_memory ?? 0;
  const used = await aiUsageGet(auth.userId, "project_memory");     // fail-closed on error
  if (used + docs.length > cap) {
    return json({ success: false, error: "Monthly Project Memory limit reached — try again next month or upgrade.", code: "cap_reached" }, 429);
  }
  // Hourly burst / shared-key-drain limit. Fails CLOSED like every other paid
  // relay (review 2026-09-05 — this was the last fail-open bucket in the tree):
  // rl < 0 = limiter unavailable → 503; and because rateLimitCount returns the
  // POST-increment count, `rl - 1 >= LIMIT` lets exactly LIMIT calls through.
  const rl = await rateLimitCount(`pm:${auth.userId}`);
  if (rl < 0) return json({ success: false, error: "Rate limiter unavailable — please try again in a moment.", code: "rate_limiter_unavailable" }, 503);
  if (rl - 1 >= PM_HOURLY_LIMIT) {
    return json({ success: false, error: "Too many Project Memory requests — please wait a moment and retry.", code: "rate_limited" }, 429);
  }

  let vectors: number[][];
  try {
    vectors = await geminiEmbed(docs.map(d => d.content));
  } catch (e) {
    console.error("[project-memory-embed] embed failed:", String(e));
    return json({ success: false, error: "Embedding failed" }, 502);
  }
  if (vectors.length !== docs.length) {
    return json({ success: false, error: "Embedding count mismatch" }, 502);
  }

  // Charge PER DOC now — the Gemini embedding cost is already incurred once the
  // embed succeeds, so charge here (before the DB upsert) rather than after, or a
  // write failure would yield unmetered Gemini spend.
  await aiUsageIncrement(auth.userId, "project_memory", docs.length);

  const now = new Date().toISOString();
  const rows = docs.map((d, i) => ({
    user_id: auth.userId,
    project_id: projectId,
    doc_id: d.doc_id,
    source: (d.source || "").slice(0, 40),
    ref: (d.ref || "").slice(0, 120),
    content: d.content.slice(0, 8000),
    embedding: toVectorLiteral(vectors[i]),
    updated_at: now,
    content_hash: typeof d.content_hash === "string" && d.content_hash ? d.content_hash.slice(0, 64) : null,
  }));

  const upsert = async (payload: Record<string, unknown>[]) => await fetch(`${SUPABASE_URL}/rest/v1/memory_embeddings?on_conflict=user_id,doc_id`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
  });

  // Upsert on (user_id, doc_id) so re-syncing edited records refreshes them.
  let r = await upsert(rows);
  if (!r.ok && r.status === 400) {
    // One-release fallback: this function deployed ahead of migration
    // 20260917170000, so `content_hash` is not a column yet (PGRST204). Write
    // without it — those rows read as stale on the next manifest and are
    // re-embedded once the column exists, which is the safe direction.
    const t = await r.text().catch(() => "");
    if (/content_hash/.test(t)) r = await upsert(rows.map(({ content_hash: _h, ...rest }) => rest));
    else r = new Response(t, { status: 400 });
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("[project-memory-embed] upsert failed:", r.status, t.slice(0, 300));
    return json({ success: false, error: "Index write failed" }, 500);
  }

  // A doc re-sent with fewer chunks than before leaves its old tail chunks
  // behind (text the drawing no longer carries). Best-effort: a failure here
  // leaves an extra chunk, never a missing one.
  const bases = [...new Set(docs.map(d => d.doc_id.replace(/#\d+$/, "")))];
  const siblings = await readIndexState(auth.userId, projectId, bases);
  if (siblings) await deleteDocs(auth.userId, projectId, orphanedChunks(docs.map(d => d.doc_id), siblings));

  return json({ success: true, embedded: rows.length });
});
