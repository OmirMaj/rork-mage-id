// project-invite
//
// Multi-user project access (Live Schedule Collaboration Phase 1). Owner invites
// a teammate by email; the teammate accepts via a single-use token link and gets
// role-based (owner/editor/viewer) access enforced by RLS on `projects` +
// `project_collaborators` (migration 20260728140000_project_collaborators.sql).
//
// Actions (POST JSON { action, ... }), all require a valid caller session JWT:
//   invite     { projectId, email, role }  — caller must OWN the project
//   accept     { token }                    — caller's email must match the invite
//   revoke     { collaboratorId }           — caller must OWN the parent project
//   changeRole { collaboratorId, role }     — caller must OWN the parent project
//
// Auth model: deployed with the default platform JWT verification (the caller's
// Supabase session). We ALSO decode the JWT here to get sub/email, then run all
// DB work with the service-role key (bypassing RLS) after our own ownership /
// token / email checks — so RLS can't be tricked and the invite flow can set
// user_id on accept.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY),
//          RESEND_API_KEY (optional — email is best-effort; the link is always
//          returned so the owner can copy/share it), APP_ORIGIN (optional).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://app.mageid.app";
const FROM_EMAIL = Deno.env.get("INVITE_FROM_EMAIL") || "MAGE ID <noreply@mageid.app>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// 'field' = operational access (schedule, daily reports, photos, RFIs, punch,
// time) with financials blinded. Must stay in sync with the role CHECK on
// project_collaborators (20260826130000_field_role.sql) — a role accepted here
// but rejected by the constraint fails the insert with an opaque 502.
const ROLES = new Set(["owner", "editor", "viewer", "field"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Service-role PostgREST helper (bypasses RLS; use only after our own checks).
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

function decodeCaller(req: Request): { sub: string; email: string } | null {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  try {
    const parts = bearer.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const p = JSON.parse(atob(b64));
    if (p && typeof p.sub === "string") {
      return { sub: p.sub, email: typeof p.email === "string" ? p.email.toLowerCase() : "" };
    }
  } catch { /* fall through */ }
  return null;
}

async function callerOwnsProject(projectId: string, uid: string): Promise<boolean> {
  const r = await rest(`projects?id=eq.${encodeURIComponent(projectId)}&select=user_id&limit=1`);
  if (!r.ok) return false;
  const rows = (await r.json()) as { user_id: string }[];
  return rows.length > 0 && rows[0].user_id === uid;
}

async function ownsCollaboratorsProject(collaboratorId: string, uid: string): Promise<{ ok: boolean; projectId?: string }> {
  const r = await rest(`project_collaborators?id=eq.${encodeURIComponent(collaboratorId)}&select=project_id&limit=1`);
  if (!r.ok) return { ok: false };
  const rows = (await r.json()) as { project_id: string }[];
  if (!rows.length) return { ok: false };
  const pid = rows[0].project_id;
  return { ok: await callerOwnsProject(pid, uid), projectId: pid };
}

function newToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// ── seat limits (mirror of utils/seatModel — keep in sync) ───────────────────
// Admin seats included per tier before overage billing. 'field' is unlimited
// and free: crew produce the labour/daily-report data the cost book learns
// from, so charging per field seat would tax the moat itself.
const INCLUDED_ADMIN_SEATS: Record<string, number> = {
  free: 0, pro: 2, business: 5, enterprise: 15,
};
const BILLABLE_ROLES = new Set(["editor", "viewer"]);
const isBillableRole = (role: string) => BILLABLE_ROLES.has(role);

/** The caller's current tier, read from `subscriptions` (same source as
 *  _shared/auth.ts). Unknown/absent ⇒ free. */
async function callerTier(userId: string): Promise<string> {
  const r = await rest(
    `subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=tier,end_date&order=updated_at.desc&limit=1`,
  );
  if (!r.ok) return "free";
  const rows = (await r.json()) as { tier?: string; end_date?: string | null }[];
  const row = rows[0];
  if (!row?.tier) return "free";
  if (row.end_date && new Date(row.end_date).getTime() < Date.now()) return "free";
  return ["pro", "business", "enterprise"].includes(row.tier) ? row.tier : "free";
}

/**
 * Would adding `email` as an admin collaborator exceed the caller's allowance?
 *
 * Seats are per ACCOUNT and de-duplicated by email, so someone already holding
 * a seat on another project is free to add here. Pending invites occupy a seat
 * (otherwise the limit is gamed by never accepting); revoked rows do not.
 *
 * NOTE: this counts collaborators on projects the CALLER owns. It uses the
 * service key, so RLS is not doing the scoping — the project_id filter is.
 */
async function seatCheck(
  ownerId: string, email: string,
): Promise<{ allowed: boolean; reason: string; used: number; included: number }> {
  const tier = await callerTier(ownerId);
  const included = INCLUDED_ADMIN_SEATS[tier] ?? 0;

  if (included === 0) {
    return {
      allowed: false,
      reason: "Inviting teammates needs a Pro plan or higher. Field access is free — invite them as Field instead.",
      used: 0,
      included: 0,
    };
  }

  // Projects this account owns.
  const pr = await rest(`projects?user_id=eq.${encodeURIComponent(ownerId)}&select=id`);
  if (!pr.ok) return { allowed: true, reason: "", used: 0, included }; // fail OPEN: never block on a lookup blip
  const ids = ((await pr.json()) as { id: string }[]).map(p => p.id);
  if (ids.length === 0) return { allowed: true, reason: "", used: 0, included };

  const inList = ids.map(encodeURIComponent).join(",");
  const cr = await rest(
    `project_collaborators?project_id=in.(${inList})&select=invited_email,role,status`,
  );
  if (!cr.ok) return { allowed: true, reason: "", used: 0, included };
  const rows = (await cr.json()) as { invited_email: string; role: string; status: string }[];

  const admins = new Set<string>();
  for (const row of rows) {
    if (row.status === "revoked" || row.role === "owner") continue;
    if (!isBillableRole(row.role)) continue;
    const e = (row.invited_email || "").trim().toLowerCase();
    if (e) admins.add(e);
  }

  const target = email.trim().toLowerCase();
  // Already holds a seat → re-invite / role change costs nothing extra.
  if (admins.has(target)) return { allowed: true, reason: "", used: admins.size, included };

  // Over the allowance. We do NOT auto-charge — the account has no per-seat
  // entitlement yet, so the honest answer is to ask them to upgrade rather than
  // silently create a seat we cannot bill for.
  if (admins.size >= included) {
    return {
      allowed: false,
      reason: `Your plan includes ${included} team seat${included === 1 ? "" : "s"} and ${admins.size} are in use. Upgrade for more, or invite them as Field — field access is always free.`,
      used: admins.size,
      included,
    };
  }
  return { allowed: true, reason: "", used: admins.size, included };
}

async function sendInviteEmail(to: string, link: string, projectName: string): Promise<void> {
  if (!RESEND_API_KEY) return; // email is best-effort; the link is returned regardless
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject: `You've been invited to collaborate on ${projectName || "a project"} in MAGE ID`,
        html: `<p>You've been invited to collaborate on <b>${projectName || "a project"}</b> in MAGE ID.</p>
               <p><a href="${link}">Open the invite</a> (sign in or create an account to accept).</p>
               <p style="color:#888;font-size:12px">If you weren't expecting this, you can ignore this email.</p>`,
      }),
    });
  } catch { /* non-fatal */ }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE) return json({ error: "Server misconfigured" }, 500);

  const caller = decodeCaller(req);
  if (!caller) return json({ error: "Unauthenticated" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = String(body.action || "");

  // ── invite ─────────────────────────────────────────────────────────────────
  if (action === "invite") {
    const projectId = String(body.projectId || "");
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "");
    if (!projectId || !email || !ROLES.has(role) || role === "owner") {
      return json({ error: "projectId, a valid email, and role (editor|viewer|field) are required" }, 400);
    }
    if (!(await callerOwnsProject(projectId, caller.sub))) {
      return json({ error: "Only the project owner can invite collaborators" }, 403);
    }
    // SEAT LIMIT — server-side. The client previews the cost and confirms, but
    // that check runs on the caller's device and is trivially bypassed by
    // calling this function directly. Billing has to be enforced where the row
    // is written. 'field' skips this entirely: crew seats are free and
    // unlimited by design (see utils/seatModel).
    if (isBillableRole(role)) {
      const seat = await seatCheck(caller.sub, email);
      if (!seat.allowed) {
        return json({
          error: seat.reason,
          code: "seat_limit",
          used: seat.used,
          included: seat.included,
        }, 402);
      }
    }
    const token = newToken();
    // Upsert on (project_id, invited_email): re-inviting refreshes the token/role.
    const ins = await rest(`project_collaborators?on_conflict=project_id,invited_email`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        project_id: projectId, invited_email: email, role,
        status: "pending", invite_token: token, invited_by: caller.sub,
      }),
    });
    if (!ins.ok) return json({ error: `Could not create invite (${ins.status})` }, 502);
    const rows = (await ins.json()) as Record<string, unknown>[];
    // Project name for the email (best-effort).
    let projectName = "";
    try {
      const pr = await rest(`projects?id=eq.${encodeURIComponent(projectId)}&select=name&limit=1`);
      if (pr.ok) projectName = (((await pr.json()) as { name?: string }[])[0]?.name) ?? "";
    } catch { /* ignore */ }
    const link = `${APP_ORIGIN}/accept-invite?token=${token}`;
    await sendInviteEmail(email, link, projectName);
    return json({ success: true, link, collaborator: rows[0] ?? null });
  }

  // ── accept ───────────────────────────────────────────────────────────────────
  if (action === "accept") {
    const token = String(body.token || "");
    if (!token) return json({ error: "Missing token" }, 400);
    const look = await rest(`project_collaborators?invite_token=eq.${encodeURIComponent(token)}&status=eq.pending&select=id,project_id,invited_email&limit=1`);
    if (!look.ok) return json({ error: "Lookup failed" }, 502);
    const rows = (await look.json()) as { id: string; project_id: string; invited_email: string }[];
    if (!rows.length) return json({ error: "This invite is invalid or already used." }, 404);
    const row = rows[0];
    if (row.invited_email.toLowerCase() !== caller.email) {
      return json({ error: "This invite was sent to a different email address." }, 403);
    }
    const upd = await rest(`project_collaborators?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: caller.sub, status: "accepted", accepted_at: new Date().toISOString(), invite_token: null }),
    });
    if (!upd.ok) return json({ error: `Could not accept (${upd.status})` }, 502);
    return json({ success: true, projectId: row.project_id });
  }

  // ── revoke ───────────────────────────────────────────────────────────────────
  if (action === "revoke") {
    const collaboratorId = String(body.collaboratorId || "");
    if (!collaboratorId) return json({ error: "Missing collaboratorId" }, 400);
    const own = await ownsCollaboratorsProject(collaboratorId, caller.sub);
    if (!own.ok) return json({ error: "Only the project owner can revoke collaborators" }, 403);
    const upd = await rest(`project_collaborators?id=eq.${encodeURIComponent(collaboratorId)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "revoked", invite_token: null }),
    });
    if (!upd.ok) return json({ error: `Could not revoke (${upd.status})` }, 502);
    return json({ success: true });
  }

  // ── changeRole ────────────────────────────────────────────────────────────────
  if (action === "changeRole") {
    const collaboratorId = String(body.collaboratorId || "");
    const role = String(body.role || "");
    if (!collaboratorId || !ROLES.has(role) || role === "owner") {
      return json({ error: "collaboratorId and role (editor|viewer|field) are required" }, 400);
    }
    const own = await ownsCollaboratorsProject(collaboratorId, caller.sub);
    if (!own.ok) return json({ error: "Only the project owner can change roles" }, 403);
    // PROMOTION IS AN INVITE. Without this, the seat limit is bypassed by
    // inviting everyone as free 'field' and then promoting them to editor.
    // seatCheck de-dupes by email, so a promotion for someone who already
    // holds an admin seat elsewhere correctly costs nothing.
    if (isBillableRole(role)) {
      const cur = await rest(
        `project_collaborators?id=eq.${encodeURIComponent(collaboratorId)}&select=invited_email,role&limit=1`,
      );
      const curRows = cur.ok ? (await cur.json()) as { invited_email: string; role: string }[] : [];
      const target = curRows[0];
      // Only charge-check when this is actually an UPGRADE into a billable role.
      if (target && !isBillableRole(target.role)) {
        const seat = await seatCheck(caller.sub, target.invited_email ?? "");
        if (!seat.allowed) {
          return json({
            error: seat.reason,
            code: "seat_limit",
            used: seat.used,
            included: seat.included,
          }, 402);
        }
      }
    }
    const upd = await rest(`project_collaborators?id=eq.${encodeURIComponent(collaboratorId)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ role }),
    });
    if (!upd.ok) return json({ error: `Could not change role (${upd.status})` }, 502);
    return json({ success: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
