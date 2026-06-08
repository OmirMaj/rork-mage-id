// portal-mark-viewed/index.ts
//
// Public endpoint (no JWT). Called from the static portal page on mount
// with the visible item IDs. Validates the portal access token (same trust
// root as portal_sign_contract / portal_choose_selection), then writes
// portal_state.viewedAt on each item — only when null (first-view-only).
//
// Trust root: the access token gates which portal_id the caller can touch.
// We never trust an item_id without confirming it belongs to the matching
// project. RLS isn't applicable here (service-role client + custom auth).
//
// jsonb convention (matches existing portal RPCs in migrations):
//   projects.client_portal->>'portalId'     (camelCase)
//   projects.client_portal->>'accessToken'  (camelCase)

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

// Constant-time compare for the portal access token — `!==` leaks a match's
// prefix length via timing. Matches validate-portal-passcode's helper.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let _d = 0;
    for (let i = 0; i < a.length; i++) _d |= a.charCodeAt(i) ^ 0;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

  // 1. Look up the project by portalId + verify access token.
  //    client_portal jsonb uses camelCase keys: portalId, accessToken
  //    (matches 20260523120000_portal_access_token.sql convention).
  const { data: project, error: projErr } = await svc
    .from("projects")
    .select("id, client_portal")
    .eq("client_portal->>portalId", body.portalId)
    .maybeSingle();
  if (projErr)
    return json({ success: false, error: "project lookup failed" }, 500);
  if (!project) return json({ success: false, error: "unknown portal" }, 404);

  const portalAccessToken = (
    project as { client_portal?: { accessToken?: string } }
  ).client_portal?.accessToken;
  if (!portalAccessToken || !constantTimeEqual(portalAccessToken, body.accessToken)) {
    return json({ success: false, error: "invalid access token" }, 401);
  }

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
      p_project_id: (project as { id: string }).id,
      p_now: nowIso,
    });
    if (!updErr) updated += 1;
  }

  return json({ success: true, updated });
});
