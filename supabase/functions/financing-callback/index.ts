// financing-callback
//
// GET/POST ?ref=<refToken>&status=<prequalified|funded|declined>
// Partner return-URL / postback target. Moves the referral status FORWARD
// only (created < clicked < prequalified < funded; declined is terminal).
// Unknown token => 200 no-op (never error). Then 302 to a thank-you page.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINANCING_THANKYOU_URL
// (optional; defaults to https://mageid.app/financing/thanks).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const THANKYOU_URL = Deno.env.get("FINANCING_THANKYOU_URL") || "https://mageid.app/financing/thanks";

const RANK: Record<string, number> = {
  created: 0, clicked: 1, prequalified: 2, funded: 3,
};

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

serve(async (req) => {
  try {
    const u = new URL(req.url);
    const ref = u.searchParams.get("ref") ?? "";
    const next = (u.searchParams.get("status") ?? "").toLowerCase();
    const allowed = ["prequalified", "funded", "declined"];
    if (!ref || !allowed.includes(next)) return redirect(THANKYOU_URL);

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: row } = await db
      .from("financing_referrals")
      .select("status")
      .eq("id", ref)
      .maybeSingle();
    if (!row) return redirect(THANKYOU_URL);

    // Forward-only. 'declined' may set from any non-terminal state; the
    // ranked states never regress.
    const shouldUpdate =
      next === "declined"
        ? row.status !== "funded" && row.status !== "declined"
        : (RANK[next] ?? -1) > (RANK[row.status] ?? -1);

    if (shouldUpdate) {
      await db
        .from("financing_referrals")
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", ref);
    }
    return redirect(THANKYOU_URL);
  } catch (err) {
    console.log("[financing-callback] error:", err);
    return redirect(THANKYOU_URL);
  }
});
