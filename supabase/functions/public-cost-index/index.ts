// public-cost-index
//
// The public read API behind the MAGE Price Index — real paid construction
// prices, free, no account. Consumed by the marketing site's cost pages and by
// AI answer engines (GEO/AEO), which is the point: nobody else publishes actual
// paid rates, so MAGE becomes the citable source.
//
// PRIVACY: this only ever returns what public_cost_index() emits, and today
// that is NOTHING — zero rows for every query (20260923180000, #84). Any
// market figure computed from rates contractors POST can be worked back to
// one contractor's exact price by the poster moving his own rate (k-anonymity
// fell to one extra account; a rounding grid fell to a threshold search), so
// no aggregate of posted rates leaves the database. The index reopens only
// when a later wave derives rates on the server from recorded job-cost
// actuals. This function cannot widen what the RPC returns.
//
// Public by design: verify_jwt is OFF (anonymous readers + crawlers).
//
// GET /public-cost-index?category=framing&unit=sf&region=US
//   → { updated?: ISO, rows: [{ category, unit, region, median, p25, p75, n }] }
//   `updated` is the day the freshest contributing rate landed — the DATA's
//   freshness, not the request time (#174). Omitted when no group is
//   published (today: always), so the page prints no "Updated <date>" line
//   instead of always printing today. `rows: []` is "not published yet",
//   which the costs page states as such; an error is a non-200.
//
// Errors (405 / 500 / 502) are sent `Cache-Control: no-store` (#174): only a
// 200 is cached, so a transient RPC failure is never pinned at the edge for a
// day as "the answer".

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
      // Cache hard at the edge — but ONLY a success. This data changes at
      // most daily and the pages built on it are meant to be crawled; an
      // error cached for 24h would show "Couldn't load" (or, before #174,
      // "still building") long after the RPC recovered.
      "Cache-Control": status === 200 ? "public, max-age=3600, s-maxage=86400" : "no-store",
      ...extra,
    },
  });
}

/** The freshest group's day, ISO; null when there is none (or none parses). */
function dataFreshness(rows: Array<Record<string, unknown>>): string | null {
  let best = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const t = typeof r.updated_at === "string" || r.updated_at instanceof Date
      ? new Date(r.updated_at as string).getTime()
      : NaN;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
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
    if (!Array.isArray(data)) {
      console.error("[public-cost-index] RPC returned a non-array");
      return json({ error: "Could not load the index." }, 502);
    }
    const rows = data.map((r: Record<string, unknown>) => ({
      category: r.category,
      unit: r.unit,
      region: r.region,
      median: r.median == null ? null : Number(r.median),
      p25: r.p25 == null ? null : Number(r.p25),
      p75: r.p75 == null ? null : Number(r.p75),
      n: Number(r.n ?? 0),
    }));
    const updated = dataFreshness(data as Array<Record<string, unknown>>);
    return json({
      ...(updated ? { updated } : {}),
      source: "MAGE ID Price Index — contractor unit rates from opted-in accounts",
      // No minimumContributors: there is no publishing floor to state while
      // nothing is published (a stale "5" / "6" would promise a rule the
      // server no longer runs). Said in words instead, only when it is true.
      ...(rows.length === 0
        ? { note: "Not published yet. MAGE ID publishes this index only once contractor rates are computed on its servers from logged job costs." }
        : {}),
      rows,
    });
  } catch (err) {
    console.error("[public-cost-index] threw:", err);
    return json({ error: "Could not load the index." }, 502);
  }
});
