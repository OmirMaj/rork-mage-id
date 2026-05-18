// financing-redirect
//
// GET ?ref=<refToken>  — emailed invoice/estimate link.
// GET ?project=<id>&src=portal — anonymous client-portal button.
// Records the homeowner click on the financing offer, then 302-redirects
// to the partner's hosted prequalification page (prefilled with amount +
// the GC's partner code + the ref token as the partner return key).
//
// MAGE is not a lender; this only forwards the homeowner to the partner.
// Unknown/missing token => safe redirect to the marketing site, never an
// error page to the homeowner.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINANCING_FALLBACK_URL
// (optional; defaults to https://mageid.app).
// FINANCING_CALLBACK_SECRET — shared HMAC key (same as financing-callback).
//   ?ref=<token> branch: caller must send x-financing-signature: hex(HMAC(key,"ref")).
//   ?project+src=portal branch: caller must send Authorization / apikey with
//     a non-trivial (length ≥ 20) value (the portal already sends these).
// Both fail-closed: no signature/token → DB write/insert skipped, redirect
// still happens.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FALLBACK_URL = Deno.env.get("FINANCING_FALLBACK_URL") || "https://mageid.app";
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

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

serve(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const ref = params.get("ref") ?? "";
    const projectParam = params.get("project") ?? "";
    const srcParam = params.get("src") ?? "";

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Two entry modes:
    //  (a) ?ref=<token>  — emailed invoice/estimate link (row pre-created
    //      by the authenticated GC via the app).
    //  (b) ?project=<id>&src=portal — the anonymous client-portal button.
    //      The homeowner has no auth.uid(), so it CANNOT insert under RLS;
    //      instead this service-role fn find-or-creates the (project,
    //      'portal') row itself. projectId in the URL leaks nothing — the
    //      homeowner is already viewing that exact project in the portal.
    let row: {
      id: string; gc_user_id: string; amount_cents: number; status: string;
    } | null = null;

    if (ref) {
      // Gate: require valid HMAC over the ref token to prevent arbitrary
      // ref enumeration from advancing referral status.
      const authed = await validSignature(req, ref);
      if (!authed) return redirect(FALLBACK_URL);
      const { data } = await db
        .from("financing_referrals").select("*").eq("id", ref).maybeSingle();
      row = data ?? null;
    } else if (projectParam && srcParam === "portal") {
      // Gate: require the portal bearer token / apikey already sent by the
      // portal client (mirrors the apikey sanity check in _shared/auth.ts).
      const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
      const bearer = auth.replace(/^Bearer\s+/i, "").trim();
      const apikey = req.headers.get("apikey") || req.headers.get("Apikey") || "";
      const hasToken = (bearer && bearer.length >= 20) || (apikey && apikey.length >= 20);
      if (!hasToken) return redirect(FALLBACK_URL);

      const { data: existing } = await db
        .from("financing_referrals")
        .select("*")
        .eq("project_id", projectParam)
        .eq("source", "portal")
        .maybeSingle();
      if (existing) {
        row = existing;
      } else {
        const { data: proj } = await db
          .from("projects").select("id,user_id").eq("id", projectParam).maybeSingle();
        if (!proj) return redirect(FALLBACK_URL);
        const id = `fin_${crypto.randomUUID().replace(/-/g, "")}`;
        const now = new Date().toISOString();
        const { data: created } = await db
          .from("financing_referrals")
          .insert({
            id, project_id: proj.id, gc_user_id: proj.user_id,
            partner_name: "", amount_cents: 0,
            status: "created", source: "portal",
            created_at: now, updated_at: now,
          })
          .select("*")
          .maybeSingle();
        row = created ?? null;
      }
    }

    if (!row) return redirect(FALLBACK_URL);

    if (row.status === "created") {
      await db
        .from("financing_referrals")
        .update({ status: "clicked", updated_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    const { data: prof } = await db
      .from("profiles")
      .select("financing")
      .eq("id", row.gc_user_id)
      .maybeSingle();
    const cfg = (prof?.financing ?? {}) as {
      prequalBaseUrl?: string; gcRefCode?: string;
    };
    const base = (cfg.prequalBaseUrl ?? "").trim();
    if (!/^https:\/\//i.test(base)) return redirect(FALLBACK_URL);

    const dest = new URL(base);
    if (row.amount_cents > 0) {
      dest.searchParams.set("amount", String(Math.round(row.amount_cents / 100)));
    }
    if (cfg.gcRefCode) dest.searchParams.set("ref_code", cfg.gcRefCode);
    dest.searchParams.set("partner_ref", row.id);
    return redirect(dest.toString());
  } catch (err) {
    console.log("[financing-redirect] error:", err);
    return redirect(FALLBACK_URL);
  }
});
