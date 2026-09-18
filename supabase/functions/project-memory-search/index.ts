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
// DB:      match_project_memory RPC (migration 20260608010000), and its
//          source-filtered overload (migration 20260917170000).
//
// SOURCES (audit round 2, #19). Plan sheets, Home Passport docs and project
// records share one (user, project) pool. Ask Your Plans used to take the 8
// nearest of EVERYTHING and keep the plan sheets, so a job with a year of daily
// reports answered "not in your plans" while the right sheet sat at rank 9.
// A caller that knows what it wants now passes `sources` and the filter runs
// inside the top-K.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageGet, aiUsageIncrement, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";
import { geminiEmbed, toVectorLiteral } from "../_shared/embeddings.ts";

// Shared with project-memory-embed: per-user hourly ceiling on memory calls.
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

interface SearchRequest { projectId?: string; query?: string; matchCount?: number; sources?: unknown }

interface Match { doc_id: string; source: string; ref: string; content: string; similarity: number }

function cleanSources(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 40))].slice(0, 10);
}

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

  // Cost ceiling (audit): monthly cap (fail-closed) + hourly burst limit, checked
  // before spending on the query embedding. Search embeds ONE query, so it charges
  // 1 (unlike embed, which charges docs.length). The hourly bucket fails CLOSED
  // like every other paid relay (review 2026-09-05): rl < 0 → 503, `rl - 1 >=`.
  const cap = MONTHLY_CAPS[auth.tier]?.project_memory ?? 0;
  const used = await aiUsageGet(auth.userId, "project_memory");
  if (used + 1 > cap) {
    return json({ success: false, error: "Monthly Project Memory limit reached — try again next month or upgrade.", code: "cap_reached" }, 429);
  }
  const rl = await rateLimitCount(`pm:${auth.userId}`);
  if (rl < 0) return json({ success: false, error: "Rate limiter unavailable — please try again in a moment.", code: "rate_limiter_unavailable" }, 503);
  if (rl - 1 >= PM_HOURLY_LIMIT) {
    return json({ success: false, error: "Too many Project Memory requests — please wait a moment and retry.", code: "rate_limited" }, 429);
  }

  let qvec: number[][];
  try {
    qvec = await geminiEmbed([query]);
  } catch (e) {
    console.error("[project-memory-search] query embed failed:", String(e));
    return json({ success: false, error: "Embedding failed" }, 502);
  }
  if (!qvec[0]) return json({ success: false, error: "Empty embedding" }, 502);

  const sources = cleanSources(body.sources);
  const callRpc = async (args: Record<string, unknown>) => await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_project_memory`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const baseArgs = {
    p_user_id: auth.userId,
    p_project_id: projectId,
    p_query: toVectorLiteral(qvec[0]),
  };
  let r = await callRpc(sources.length > 0
    ? { ...baseArgs, p_match_count: matchCount, p_sources: sources }
    : { ...baseArgs, p_match_count: matchCount });
  // One-release fallback: deployed ahead of migration 20260917170000, the
  // 5-argument overload does not exist (PostgREST 404 PGRST202). Ask the old
  // form for its maximum and filter here — weaker (the filter runs after a
  // top-24, not inside it) but never worse than before.
  let filterHere = false;
  if (!r.ok && sources.length > 0 && r.status === 404) {
    await r.text().catch(() => "");
    r = await callRpc({ ...baseArgs, p_match_count: 24 });
    filterHere = true;
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("[project-memory-search] rpc failed:", r.status, t.slice(0, 300));
    return json({ success: false, error: "Search failed" }, 500);
  }
  const raw = await r.json();
  let matches: Match[] = Array.isArray(raw) ? raw as Match[] : [];
  if (filterHere) matches = matches.filter(m => sources.includes(m.source)).slice(0, matchCount);
  await aiUsageIncrement(auth.userId, "project_memory", 1);
  return json({ success: true, matches });
});
