// financing-redirect
//
// GET ?ref=<refToken>                               — emailed invoice link.
// GET ?project=<id>&src=portal&portal=<portalId>&t=<accessToken>
//                                                   — client-portal button.
// Records the homeowner click on the financing offer, then 302-redirects
// to the partner's hosted prequalification page (prefilled with amount +
// the GC's partner code + the ref token as the partner return key).
//
// MAGE is not a lender, has no lending partner and is not paid for the
// referral ("bring your own lender"); this only forwards the homeowner to the
// lender the GC named in Payments.
// Unknown/missing token => safe redirect to the marketing site, never an
// error page to the homeowner.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINANCING_FALLBACK_URL
// (optional; defaults to https://mageid.app). verify_jwt = false
// (supabase/config.toml): a homeowner's browser has no JWT.
//
// HOW EACH ENTRY IS AUTHENTICATED (#180). Both used to demand a HEADER — an
// x-financing-signature HMAC, or an Authorization/apikey of 20+ chars — that
// a link opened in a browser can never send, so every real click fell back
// to the MAGE ID homepage instead of the lender:
//   ?ref=  The ref IS the capability: hooks/useFinancingReferrals mints it as
//          `fin_` + 32 hex chars of a random UUID (122 random bits), under
//          RLS, for the GC's own row. It must match REF_RE exactly and name an
//          existing row; the only state it can move is created → clicked, so
//          replaying a click advances nothing. (An HMAC over a value that is
//          itself in the URL would add nothing — and the app could not mint
//          one without shipping the secret.) FINANCING_CALLBACK_SECRET stays
//          with financing-callback, where the partner's SERVER signs.
//   portal The homeowner's portal access token (`t`) and portal id must
//          resolve through portal_project_for_token — the same resolver the
//          portal RPCs use (live, expiry-aware) — to exactly the `project` in
//          the URL. Anything else falls back; nothing is inserted.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FALLBACK_URL = Deno.env.get("FINANCING_FALLBACK_URL") || "https://mageid.app";
// Exactly what useFinancingReferrals / the portal branch below mint:
// `fin_` + a UUID with its dashes removed (lower-case hex).
const REF_RE = /^fin_[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    //  (a) ?ref=<token>  — emailed invoice link (row pre-created by the
    //      authenticated GC via the app, and brought to THAT invoice's amount
    //      before each send — hooks/useFinancingReferrals.ensureReferral —
    //      because the amount prefilled below is read from the row).
    //  (b) ?project=<id>&src=portal&portal=<portalId>&t=<accessToken> — the
    //      client-portal button. The homeowner has no auth.uid(), so it
    //      CANNOT insert under RLS; instead this service-role fn
    //      find-or-creates the (project, 'portal') row itself, but only once
    //      the portal token proves the caller is that project's homeowner.
    let row: {
      id: string; gc_user_id: string; amount_cents: number; status: string;
    } | null = null;

    if (ref) {
      // The ref is an unguessable capability (see header). Refuse anything
      // that isn't one before touching the database.
      if (!REF_RE.test(ref)) return redirect(FALLBACK_URL);
      const { data } = await db
        .from("financing_referrals").select("*").eq("id", ref).maybeSingle();
      row = data ?? null;
    } else if (projectParam && srcParam === "portal") {
      // The portal button carries the homeowner's portal id + access token.
      // They must resolve to THIS project — otherwise anyone who learned a
      // project id could mint referral rows against a GC's account.
      const portalParam = params.get("portal") ?? "";
      const accessToken = params.get("t") ?? "";
      if (!UUID_RE.test(projectParam) || !portalParam || !accessToken) return redirect(FALLBACK_URL);
      const { data: resolved, error: resolveErr } = await db.rpc("portal_project_for_token", {
        p_portal_id: portalParam,
        p_access_token: accessToken,
      });
      if (resolveErr || typeof resolved !== "string" || resolved.toLowerCase() !== projectParam.toLowerCase()) {
        return redirect(FALLBACK_URL);
      }
      const projectId = resolved;

      const { data: existing } = await db
        .from("financing_referrals")
        .select("*")
        .eq("project_id", projectId)
        .eq("source", "portal")
        .maybeSingle();
      if (existing) {
        row = existing;
      } else {
        const { data: proj } = await db
          .from("projects").select("id,user_id").eq("id", projectId).maybeSingle();
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
