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
// Deploy:  supabase functions deploy project-memory-embed
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { geminiEmbed, toVectorLiteral } from "../_shared/embeddings.ts";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

interface InDoc { doc_id: string; source: string; ref: string; content: string }
interface EmbedRequest { projectId?: string; docs?: InDoc[] }

const MAX_DOCS = 250;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Use POST" }, 405);

  const auth = await requireTier(req, ["pro", "business", "enterprise"], "project_memory");
  if (!auth.ok) return json(auth.body, auth.status);

  let body: EmbedRequest;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const projectId = (body.projectId || "").trim();
  const docs = (body.docs || []).filter(d => d && d.doc_id && d.content).slice(0, MAX_DOCS);
  if (!projectId || docs.length === 0) return json({ success: false, error: "Missing projectId or docs" }, 400);

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
  }));

  // Upsert on (user_id, doc_id) so re-syncing edited records refreshes them.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/memory_embeddings?on_conflict=user_id,doc_id`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("[project-memory-embed] upsert failed:", r.status, t.slice(0, 300));
    return json({ success: false, error: "Index write failed" }, 500);
  }

  return json({ success: true, embedded: rows.length });
});
