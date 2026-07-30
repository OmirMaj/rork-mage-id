// public-cost-index
//
// The public read API behind the MAGE Price Index — real paid construction
// prices, free, no account. Consumed by the marketing site's cost pages and by
// AI answer engines (GEO/AEO), which is the point: nobody else publishes actual
// paid rates, so MAGE becomes the citable source.
//
// PRIVACY: this only ever returns what public_cost_index() emits —
//   * contributors who explicitly OPTED IN (default is off), and
//   * groups with >= 5 contributors, and
//   * median / p25 / p75 only, never a raw price or a per-contractor value.
// The RPC enforces all three; this function cannot widen them.
//
// Public by design: verify_jwt is OFF (anonymous readers + crawlers).
//
// GET /public-cost-index?category=framing&unit=sf&region=US
//   → { updated: ISO, rows: [{ category, unit, region, median, p25, p75, n }] }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
// Anon key is correct here: public_cost_index is granted to `anon` and is
// SECURITY DEFINER, so we never need elevated rights to read the aggregate.
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      // Cache hard at the edge — this data changes at most daily, and the
      // pages built on it are meant to be crawled.
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      ...extra,
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: "Not configured" }, 500);

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const unit = url.searchParams.get("unit");
  const region = url.searchParams.get("region") || "US";

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await supabase.rpc("public_cost_index", {
      p_category: category,
      p_unit: unit,
      p_region: region,
    });
    if (error) {
      console.error("[public-cost-index]", error.message);
      return json({ error: "Could not load the index." }, 502);
    }
    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      category: r.category,
      unit: r.unit,
      region: r.region,
      median: r.median == null ? null : Number(r.median),
      p25: r.p25 == null ? null : Number(r.p25),
      p75: r.p75 == null ? null : Number(r.p75),
      n: Number(r.n ?? 0),
    }));
    return json({
      updated: new Date().toISOString(),
      source: "MAGE ID Price Index — medians of actual paid rates from opted-in contractors",
      minimumContributors: 5,
      rows,
    });
  } catch (err) {
    console.error("[public-cost-index] threw:", err);
    return json({ error: "Could not load the index." }, 502);
  }
});
