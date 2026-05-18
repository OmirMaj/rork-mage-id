// financing-callback
//
// GET/POST ?ref=<refToken>&status=<prequalified|funded|declined>
// Partner return-URL / postback target. Moves the referral status FORWARD
// only (created < clicked < prequalified < funded; declined is terminal).
// Unknown token => 200 no-op (never error). Then 302 to a thank-you page.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINANCING_THANKYOU_URL
// (optional; defaults to https://mageid.app/financing/thanks).
// FINANCING_CALLBACK_SECRET — HMAC-SHA256 key. When set, the caller must
// send x-financing-signature: <hex(HMAC-SHA256(key, "ref:next"))>.
// Unset (or invalid sig) => DB write is skipped but redirect still happens
// (fail-closed; financing feature is currently dormant).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const THANKYOU_URL = Deno.env.get("FINANCING_THANKYOU_URL") || "https://mageid.app/financing/thanks";
const FINANCING_CALLBACK_SECRET = Deno.env.get("FINANCING_CALLBACK_SECRET") || "";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function validSignature(req: Request, signedPayload: string): Promise<boolean> {
  if (!FINANCING_CALLBACK_SECRET) return false; // fail closed (financing dormant)
  const provided = req.headers.get("x-financing-signature") || "";
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(FINANCING_CALLBACK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, provided.toLowerCase());
}

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

    const authed = await validSignature(req, `${ref}:${next}`);
    if (shouldUpdate && authed) {
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
