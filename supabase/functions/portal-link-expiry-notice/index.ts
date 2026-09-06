// portal-link-expiry-notice — tell the GC BEFORE their client hits a dead link.
//
// THE PROBLEM. A client portal link is the GC's face to their customer. When it
// expires, the person who finds out is the CLIENT — they tap a link from an
// email, get a wall, and have to chase the contractor. The contractor learns
// their portal is broken from an annoyed customer, which is the worst possible
// channel.
//
// This flips it: the GC is warned while the link still works, and told again
// once it lapses, so they can re-share before anyone is inconvenienced.
//
// WHAT IT DOES. Twice-daily sweep over public.portal_snapshots:
//   • expires within EXPIRING_SOON_DAYS  → 'portal_link_expiring' notice
//   • already past expires_at             → 'portal_link_expired'  notice
// Rows with expires_at IS NULL never expire and are skipped entirely — that is
// the documented "no expiry" choice, not a missing value.
//
// IDEMPOTENCE. Notices are written to public.notification_outbox, which the
// existing fan-out already turns into push + email. Before inserting we check
// for a notice of the SAME event_type against the SAME portal in the last
// NOTICE_COOLDOWN_HOURS, so a twice-daily cron (or a retry) cannot nag the GC
// every run. That check is the only thing standing between "helpful" and
// "the reason they turn notifications off".
//
// AUTH. Cron-only, guarded by the shared verify_cron_secret pattern used by the
// other scheduled functions — a signed-in user must not be able to trigger a
// fan-out across every GC's portals.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// House cron-auth: validates the header via the SECURITY DEFINER
// verify_cron_secret RPC so the secret value never leaves the database.
// Hand-comparing an env var would work but would be the only function here
// that does it differently.
import { isValidCron } from "../_shared/cronAuth.ts";
// EDGE-F6: the ONE place a customer-facing portal URL is built (minted id + ?t= token).
import { portalUrlFor } from "../_shared/portalLinks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

/** Warn this many days out — enough time to re-share before the client notices. */
const EXPIRING_SOON_DAYS = 3;
/** Never send the same kind of notice for the same portal twice inside this window. */
const NOTICE_COOLDOWN_HOURS = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function rest(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

interface PortalRow {
  portal_id: string;
  project_id: string | null;
  expires_at: string | null;
}

type Kind = "portal_link_expiring" | "portal_link_expired";

/** Has this exact notice already gone out recently? */
async function recentlyNotified(portalId: string, kind: Kind): Promise<boolean> {
  const since = new Date(Date.now() - NOTICE_COOLDOWN_HOURS * 3600_000).toISOString();
  const r = await rest(
    `notification_outbox?event_type=eq.${kind}` +
    `&source_table=eq.portal_snapshots&source_id=eq.${encodeURIComponent(portalId)}` +
    `&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
  );
  if (!r.ok) return true; // fail CLOSED: if we cannot tell, do NOT risk nagging
  return ((await r.json()) as unknown[]).length > 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE) return json({ error: "Server misconfigured" }, 500);

  // Cron-only. A user-triggered run would fan out across every GC's portals,
  // so unlike morning-digest there is deliberately no authenticated-user path.
  if (!(await isValidCron(req))) return json({ error: "Forbidden" }, 403);

  const nowMs = Date.now();
  const soonIso = new Date(nowMs + EXPIRING_SOON_DAYS * 86_400_000).toISOString();

  // Only rows that actually carry an expiry. NULL = never expires, by design.
  const pr = await rest(
    `portal_snapshots?expires_at=not.is.null&expires_at=lte.${encodeURIComponent(soonIso)}` +
    `&select=portal_id,project_id,expires_at`,
  );
  if (!pr.ok) return json({ error: `Could not read portals (${pr.status})` }, 502);
  const portals = (await pr.json()) as PortalRow[];

  let expiring = 0, expired = 0, skipped = 0;

  for (const p of portals) {
    if (!p.expires_at || !p.project_id) { skipped++; continue; }
    const expMs = Date.parse(p.expires_at);
    if (!Number.isFinite(expMs)) { skipped++; continue; }

    const kind: Kind = expMs <= nowMs ? "portal_link_expired" : "portal_link_expiring";
    if (await recentlyNotified(p.portal_id, kind)) { skipped++; continue; }

    // Who owns the project — the GC we are warning.
    const projr = await rest(`projects?id=eq.${encodeURIComponent(p.project_id)}&select=user_id,name,client_portal&limit=1`);
    if (!projr.ok) { skipped++; continue; }
    const proj = ((await projr.json()) as { user_id: string; name: string; client_portal?: unknown }[])[0];
    if (!proj?.user_id) { skipped++; continue; }
    // EDGE-F6: the client's CURRENT link, built by the shared helper (minted id
    // + ?t= token), so the GC can re-share it straight from the notice. null =
    // portal disabled / no token → omitted, never a dead /portal/<project.id>.
    const portalUrl = portalUrlFor(proj.client_portal);

    const daysLeft = Math.max(0, Math.ceil((expMs - nowMs) / 86_400_000));
    const title = kind === "portal_link_expired"
      ? `Client portal link expired — ${proj.name}`
      : `Client portal link expires in ${daysLeft}d — ${proj.name}`;
    const body = kind === "portal_link_expired"
      ? "Your client's link no longer opens. Generate a new one so they aren't left chasing you."
      : "Share a fresh link, or set this portal to never expire, before your client hits a dead end.";

    const ins = await rest("notification_outbox", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        event_type: kind,
        source_table: "portal_snapshots",
        source_id: p.portal_id,
        // 'gc', not 'user': notification_outbox_recipient_kind_check accepts
        // ONLY ('gc','client','sub'). Anything else is a 23514 check violation,
        // and the `if (!ins.ok) skipped++` below would swallow it — the cron
        // would run twice daily forever and notify nobody. The recipient here
        // is the general contractor who owns the project.
        recipient_kind: "gc",
        recipient_user_id: proj.user_id,
        payload: {
          title,
          body,
          projectId: p.project_id,
          projectName: proj.name,
          portalId: p.portal_id,
          expiresAt: p.expires_at,
          daysLeft,
          // Only while the link still opens — an expired portal's URL IS the dead
          // link this notice exists to warn about, so it is never attached.
          ...(kind === "portal_link_expiring" && portalUrl ? { portalUrl } : {}),
          // Deep-link straight to the screen that can fix it.
          route: "/client-portal-setup",
        },
      }),
    });
    if (!ins.ok) {
      // LOG, never swallow. A rejected insert here means the GC is not told
      // their client's link died — the whole point of this function — and a
      // bare `skipped++` makes that indistinguishable from "nothing to do".
      // A bad recipient_kind shipped exactly this way once; it would have run
      // twice daily forever, reporting success and notifying nobody.
      console.error(
        `[portal-link-expiry-notice] outbox insert rejected (${ins.status}) for portal ${p.portal_id}:`,
        await ins.text().catch(() => "<no body>"),
      );
      skipped++;
      continue;
    }
    if (kind === "portal_link_expired") expired++; else expiring++;
  }

  // `skipped` is surfaced in the response so a non-zero value is visible to
  // whoever checks the cron, rather than buried in logs nobody opens.
  return json({ success: true, scanned: portals.length, expiring, expired, skipped });
});
