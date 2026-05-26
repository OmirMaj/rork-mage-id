import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { loadConnection, svc } from "../_shared/qbo.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const auth = await requireTier(req, ["business", "enterprise"], "qbo_status");
  if (!auth.ok) return json(auth.body, auth.status);

  const conn = await loadConnection(auth.userId);
  if (!conn) return json({ success: true, status: "disconnected" });

  // Count invoices by qbo_sync_status for the user.
  const s = svc();
  const { count: errorCount } = await s
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .eq("qbo_sync_status", "error");
  const { count: pendingCount } = await s
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .eq("qbo_sync_status", "pending");
  const { count: syncedCount } = await s
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .eq("qbo_sync_status", "synced");

  return json({
    success: true,
    status: conn.status,
    realmId: conn.realm_id,
    environment: conn.environment,
    companyName: conn.company_name,
    lastSyncAt: (conn as { last_sync_at?: string | null }).last_sync_at ?? null,
    counts: {
      synced: syncedCount ?? 0,
      pending: pendingCount ?? 0,
      error: errorCount ?? 0,
    },
  });
});
