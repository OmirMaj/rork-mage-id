// project-memory-search
//
// Project Memory v2 retrieval. Embeds the user's question and runs cosine ANN
// (match_project_memory RPC) over their project's indexed records, returning the
// top-K with similarity. The client then feeds these into the existing mageAI
// relay to compose the cited answer (same as the TF-IDF path) — so the answer
// stays metered + consistent; only retrieval changes.
//
// Deploy:  supabase functions deploy project-memory-search
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY.
// DB:      match_project_memory RPC (migration 20260608010000).

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

interface SearchRequest { projectId?: string; query?: string; matchCount?: number }

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ success: false, error: "Use POST" }, 405);

  const auth = await requireTier(req, ["pro", "business", "enterprise"], "project_memory");
  if (!auth.ok) return json(auth.body, auth.status);

  let body: SearchRequest;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const projectId = (body.projectId || "").trim();
  const query = (body.query || "").trim();
  const matchCount = Math.max(1, Math.min(24, body.matchCount ?? 8));
  if (!projectId || !query) return json({ success: false, error: "Missing projectId or query" }, 400);

  let qvec: number[][];
  try {
    qvec = await geminiEmbed([query]);
  } catch (e) {
    console.error("[project-memory-search] query embed failed:", String(e));
    return json({ success: false, error: "Embedding failed" }, 502);
  }
  if (!qvec[0]) return json({ success: false, error: "Empty embedding" }, 502);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_project_memory`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: auth.userId,
      p_project_id: projectId,
      p_query: toVectorLiteral(qvec[0]),
      p_match_count: matchCount,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("[project-memory-search] rpc failed:", r.status, t.slice(0, 300));
    return json({ success: false, error: "Search failed" }, 500);
  }
  const matches = await r.json();
  return json({ success: true, matches: Array.isArray(matches) ? matches : [] });
});
