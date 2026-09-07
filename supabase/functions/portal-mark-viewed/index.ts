// portal-mark-viewed/index.ts
//
// Public endpoint (no JWT). Called from the static portal page on mount
// with the visible item IDs. Authorises the (portalId, accessToken) pair
// through portal_project_for_token — the same SECURITY DEFINER choke point
// portal_sign_contract / portal_choose_selection use — then writes
// portal_state.viewedAt on each item — only when null (first-view-only).
//
// Trust root: the access token gates which portal_id the caller can touch,
// and the choke point is the one place that knows what a valid link is
// (token + enabled, and NOT EXPIRED once 20260904100800 is applied —
// AUTH-F7). Until the 2026-09-05 review this file read projects.client_portal
// and compared the token itself, so an expired link could still stamp
// viewedAt on the owner's items. We never trust an item_id without
// confirming it belongs to the matching project. RLS isn't applicable here
// (service-role client + custom auth).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Kind =
  | "change_order"
  | "invoice"
  | "aia_pay_app"
  | "rfi"
  | "submittal"
  | "daily_report"
  | "photo"
  | "selection"
  | "warranty";

const TABLE: Record<Kind, string> = {
  change_order: "change_orders",
  invoice: "invoices",
  aia_pay_app: "aia_pay_apps",
  rfi: "rfis",
  submittal: "submittals",
  daily_report: "daily_reports",
  photo: "photos",
  selection: "selection_categories",
  warranty: "warranties",
};

interface Body {
  portalId: string;
  accessToken: string;
  items: { kind: Kind; id: string }[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return json({ success: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY)
    return json({ success: false, error: "svc not configured" }, 500);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ success: false, error: "Bad JSON" }, 400);
  }
  if (!body.portalId || !body.accessToken || !Array.isArray(body.items)) {
    return json(
      { success: false, error: "Missing portalId / accessToken / items" },
      400
    );
  }
  if (body.items.length > 200)
    return json({ success: false, error: "Too many items" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Authorise through the choke point. portal_project_for_token (EXECUTE
  //    for service_role only; the two-argument signature is the only one in
  //    production) answers the project uuid for an enabled, un-expired
  //    portal whose token matches — or null. One answer for unknown portal /
  //    disabled / wrong token / expired: no oracle for the caller.
  const { data: gate, error: gateErr } = await svc.rpc("portal_project_for_token", {
    p_portal_id: body.portalId,
    p_access_token: body.accessToken,
  });
  if (gateErr)
    return json({ success: false, error: "project lookup failed" }, 500);
  const projectId = typeof gate === "string" && UUID_RE.test(gate) ? gate : null;
  if (!projectId) return json({ success: false, error: "invalid portal link" }, 401);

  // 2. For each item: scoped update — only set viewedAt when null
  //    AND the row belongs to this project.
  const nowIso = new Date().toISOString();
  let updated = 0;
  for (const it of body.items) {
    const tbl = TABLE[it.kind];
    if (!tbl) continue;
    const { error: updErr } = await svc.rpc("portal_mark_item_viewed", {
      p_table_name: tbl,
      p_item_id: it.id,
      p_project_id: projectId,
      p_now: nowIso,
    });
    if (!updErr) updated += 1;
  }

  return json({ success: true, updated });
});
