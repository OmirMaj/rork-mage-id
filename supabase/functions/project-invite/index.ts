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
//   listPending   {}                        — invites waiting for the caller's email
//   acceptPending { collaboratorId }        — accept one of those, same email check
//   revoke     { collaboratorId }           — caller must OWN the parent project
//   changeRole { collaboratorId, role }     — caller must OWN the parent project
//   getLink    { collaboratorId }           — owner re-reads a PENDING row's link
//                                              (no token rotation, #177)
//   leave      { projectId }                — a collaborator removes HIMSELF
//
// Auth model: deployed with the default platform JWT verification (the caller's
// Supabase session). We ALSO verify the JWT with GoTrue here (verifyUser →
// sub/email), then run all DB work with the service-role key (bypassing RLS)
// after our own ownership / token / email checks — so RLS can't be tricked
// and the invite flow can set user_id on accept.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY),
//          RESEND_API_KEY (optional — email is best-effort; the link is always
//          returned so the owner can copy/share it), APP_ORIGIN (optional).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { verifyUser } from "../_shared/verifyUser.ts";

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

/** Accept a pending row for `uid`. The status filter makes a double-accept
 *  (two devices, or the link and the Home card) a no-op, not a re-stamp. */
async function markAccepted(collaboratorId: string, uid: string): Promise<Response> {
  return rest(`project_collaborators?id=eq.${encodeURIComponent(collaboratorId)}&status=eq.pending`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: uid, status: "accepted", accepted_at: new Date().toISOString(), invite_token: null }),
  });
}

/** s•••@example.com — enough for the owner of the address to recognise it. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 1)}•••@${domain}`;
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

/** A master account (the team's own logins) — public.is_master_account, the
 *  SQL copy of _shared/auth.ts MASTER_EMAILS that the project-cap trigger also
 *  reads (validate-w5-project-cap-master-lists keeps the copies in sync). Read
 *  through the service role (EXECUTE is service-role only), so this function
 *  carries no fourth copy of the list. A failed read is "not master": the
 *  subscriptions row still decides, exactly as before this check existed. */
async function isMasterAccount(userId: string): Promise<boolean> {
  try {
    const r = await rest("rpc/is_master_account", {
      method: "POST",
      body: JSON.stringify({ p_user_id: userId }),
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch {
    return false;
  }
}

/** The caller's current tier, read from `subscriptions` (same source as
 *  _shared/auth.ts). Unknown/absent ⇒ free. A master account is Business,
 *  whatever its row says — the same override requireTier applies (audit wave
 *  5, #1: the founder's account, whose row reads 'free', was refused seats
 *  here while every other gate treated him as Business). */
async function callerTier(userId: string): Promise<string> {
  if (await isMasterAccount(userId)) return "business";
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

/** HTML-escape text interpolated into the email body. The project name and
 *  the inviter's company are typed by users; raw, a name with `<a href=…>` in
 *  it rendered as a link inside a MAGE-branded email (#177). */
function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Subject lines are plain text, but a CR/LF in one is a header-injection
 *  shape some relays honour; collapse whitespace and cap the length. */
function plainLine(v: string, max = 80): string {
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

const ROLE_WORD: Record<string, string> = { editor: "Editor", viewer: "Viewer", field: "Field" };
const ROLE_LINE: Record<string, string> = {
  editor: "You'll be able to edit the job, including its costs.",
  viewer: "You'll be able to see the job, including its costs, read-only.",
  field: "You'll see the schedule and the field work — daily reports, photos, RFIs, punch list.",
};

export type InviteEmailResult = { sent: boolean; reason?: "not_configured" | "rejected" | "network" };

/**
 * #177: the send's outcome is REPORTED, not swallowed. It used to return void
 * whatever happened — RESEND_API_KEY unset, Resend refusing the address, the
 * network failing — and the function still answered success, so the roster
 * said "Invited" and the GC waited on an email that never left.
 */
async function sendInviteEmail(
  to: string, link: string, projectName: string, inviterName: string, role: string,
): Promise<InviteEmailResult> {
  if (!RESEND_API_KEY) return { sent: false, reason: "not_configured" };
  const project = plainLine(projectName) || "a project";
  const who = plainLine(inviterName) || "A contractor";
  const roleWord = ROLE_WORD[role] ?? "";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject: `${who} invited you to ${project}${roleWord ? ` as ${roleWord}` : ""} — MAGE ID`,
        html: `<p><b>${escapeHtml(who)}</b> invited you to <b>${escapeHtml(project)}</b> in MAGE ID${roleWord ? ` as <b>${escapeHtml(roleWord)}</b>` : ""}.</p>
               ${ROLE_LINE[role] ? `<p>${escapeHtml(ROLE_LINE[role])}</p>` : ""}
               <p><a href="${escapeHtml(link)}">Open the invite</a> (sign in or create a free account with this address to accept).</p>
               <p style="color:#888;font-size:12px">If you weren't expecting this, you can ignore this email.</p>`,
      }),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch { /* body is diagnostics only */ }
      console.error("[project-invite] Resend rejected the invite email:", res.status, detail);
      return { sent: false, reason: "rejected" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[project-invite] invite email send failed:", err instanceof Error ? err.message : String(err));
    return { sent: false, reason: "network" };
  }
}

/** The inviter as the invitee knows him: company first, then his name. */
async function inviterDisplayName(uid: string): Promise<string> {
  try {
    const prof = await rest(`profiles?id=eq.${encodeURIComponent(uid)}&select=name,company_name&limit=1`);
    if (!prof.ok) return "";
    const p = ((await prof.json()) as { name?: string; company_name?: string }[])[0];
    return (p?.company_name || p?.name || "").trim();
  } catch {
    return "";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE) return json({ error: "Server misconfigured" }, 500);

  // Audit EDGE-F14: identity AND email come from GoTrue (verifyUser), never
  // from a bare claims decode — `accept` compares the invite's address to the
  // caller's, so a forged `email` claim used to be enough to take a seat on
  // someone else's project.
  const verified = await verifyUser(req);
  if (!verified?.id) return json({ error: "Unauthenticated" }, 401);
  const caller = { sub: verified.id, email: (verified.email ?? "").toLowerCase() };

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
    // AN ACTIVE MEMBER IS NEVER RE-INVITED (audit round 2 #27). The upsert
    // below writes status 'pending' and a fresh token, and every RLS gate
    // (can_access_project) requires status = 'accepted' — so re-sending to
    // someone already on the job, whether to "fix" his role or because "I
    // can't find the link", locked a working super out of the schedule, daily
    // reports and photos until he found the new email and accepted again. A
    // role change on an active member is changeRole's job (it keeps him
    // accepted and runs the same seat check). Answered with 200 + `error`, not
    // a 4xx: supabase.functions.invoke drops the body of a non-2xx response,
    // and this message is the only thing that tells the owner what to do.
    // Pending and revoked rows fall through and are (re)issued as before.
    // #129: a PENDING row re-sent with the SAME role keeps its token (below).
    let reuseToken: string | null = null;
    {
      const ex = await rest(
        `project_collaborators?project_id=eq.${encodeURIComponent(projectId)}&invited_email=eq.${encodeURIComponent(email)}&select=id,role,status,invite_token&limit=1`,
      );
      if (!ex.ok) return json({ error: `Could not check the roster (${ex.status})` }, 502);
      const existing = ((await ex.json()) as { id: string; role: string; status: string; invite_token: string | null }[])[0];
      // #129: re-sending to someone still PENDING in the same role re-emails
      // the SAME link. Minting a new token killed the link the GC had already
      // texted his foreman — typically because a failed or offline Team read
      // showed "No collaborators yet" and he re-typed the address. A role
      // change or a revoked row still gets a fresh token (the old link must
      // not grant the old role, or a seat he was removed from).
      if (existing?.status === "pending" && existing.role === role && existing.invite_token) {
        reuseToken = existing.invite_token;
      }
      if (existing?.status === "accepted") {
        return json({
          success: false,
          code: "already_member",
          collaboratorId: existing.id,
          role: existing.role,
          error: `${email} is already on this job. To change what they can see, use the role buttons on their row — re-sending an invite would lock them out until they accept again.`,
        });
      }
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
    const token = reuseToken ?? newToken();
    // Upsert on (project_id, invited_email): re-inviting a REVOKED row, or a
    // PENDING one in a new role, refreshes the token/role; a same-role
    // pending re-send keeps its token (#129). An accepted row returned above.
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
    const inviterName = await inviterDisplayName(caller.sub);
    const mail = await sendInviteEmail(email, link, projectName, inviterName, role);
    // #177: emailSent tells the owner's screen whether to say "Emailed to X"
    // or "Email not sent — copy the link". The invite row exists either way.
    return json({ success: true, link, collaborator: rows[0] ?? null, emailSent: mail.sent, emailReason: mail.reason ?? null, linkReused: reuseToken !== null });
  }

  // ── getLink ──────────────────────────────────────────────────────────────────
  // #177: the copy-link fallback lived only in the invite form's state, so
  // once the GC left the screen his only way to the link again was re-sending
  // — which rotates the token and kills the link he may already have texted.
  // This re-reads the CURRENT token of a still-pending row; nothing changes.
  if (action === "getLink") {
    const collaboratorId = String(body.collaboratorId || "");
    if (!collaboratorId) return json({ error: "Missing collaboratorId" }, 400);
    const own = await ownsCollaboratorsProject(collaboratorId, caller.sub);
    if (!own.ok) return json({ error: "Only the project owner can copy an invite link" }, 403);
    const r = await rest(`project_collaborators?id=eq.${encodeURIComponent(collaboratorId)}&select=status,invite_token&limit=1`);
    if (!r.ok) return json({ error: `Could not read the invite (${r.status})` }, 502);
    const row = ((await r.json()) as { status: string; invite_token: string | null }[])[0];
    if (!row || row.status !== "pending" || !row.invite_token) {
      // 200 + error: invoke() drops a non-2xx body, and this line is the answer.
      return json({ success: false, code: "not_pending", error: "This invite isn't waiting any more — they've accepted it or it was removed." });
    }
    return json({ success: true, link: `${APP_ORIGIN}/accept-invite?token=${row.invite_token}` });
  }

  // ── leave ────────────────────────────────────────────────────────────────────
  // A collaborator takes HIMSELF off a job (the project hub's "Leave"). Only
  // his own row — matched on his user id, or on his verified email for an
  // invite he never accepted — and never the owner's: an owner leaving his own
  // project would orphan it. Server-authoritative like revoke, so it is not
  // queued offline.
  if (action === "leave") {
    const projectId = String(body.projectId || "");
    if (!projectId) return json({ error: "Missing projectId" }, 400);
    if (await callerOwnsProject(projectId, caller.sub)) {
      return json({ success: false, code: "owner", error: "You own this project, so you can't leave it. Delete or hand it over instead." });
    }
    // Two plain eq. filters, not one or=(…) splice: the email is user text,
    // and a comma or parenthesis in it would re-shape an or-list (the
    // PostgREST splice class the 2026-09-03 audit found in `.in()`).
    const base = `project_collaborators?project_id=eq.${encodeURIComponent(projectId)}&status=neq.revoked`;
    const patch = { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "revoked", invite_token: null }) };
    const mine = await rest(`${base}&user_id=eq.${encodeURIComponent(caller.sub)}`, patch);
    if (!mine.ok) return json({ error: `Could not leave the project (${mine.status})` }, 502);
    let changed = ((await mine.json()) as unknown[]).length;
    if (caller.email) {
      const invited = await rest(`${base}&status=eq.pending&invited_email=eq.${encodeURIComponent(caller.email)}`, patch);
      if (!invited.ok) return json({ error: `Could not leave the project (${invited.status})` }, 502);
      changed += ((await invited.json()) as unknown[]).length;
    }
    if (!changed) {
      return json({ success: false, code: "not_member", error: "You're not on this project any more." });
    }
    return json({ success: true });
  }

  // ── accept ───────────────────────────────────────────────────────────────────
  // The two answers the INVITEE must be able to act on (a used link, a
  // different address) come back as 200 + { success:false, code, error }:
  // supabase.functions.invoke drops the body of a non-2xx response, so the
  // old 404/403 reached the screen as "Edge Function returned a non-2xx
  // status code" — and the email-mismatch case (Sign in with Apple's hidden
  // relay; a personal address when the GC typed the work one) was a dead end
  // neither side could diagnose (audit round 2 #29).
  if (action === "accept") {
    const token = String(body.token || "");
    if (!token) return json({ error: "Missing token" }, 400);
    const look = await rest(`project_collaborators?invite_token=eq.${encodeURIComponent(token)}&status=eq.pending&select=id,project_id,invited_email&limit=1`);
    if (!look.ok) return json({ error: "Lookup failed" }, 502);
    const rows = (await look.json()) as { id: string; project_id: string; invited_email: string }[];
    if (!rows.length) {
      return json({ success: false, code: "invalid_or_used", error: "This invite is invalid or already used. If you already accepted it, the project is in your list; otherwise ask the owner to send it again." });
    }
    const row = rows[0];
    if (row.invited_email.toLowerCase() !== caller.email) {
      return json({
        success: false,
        code: "email_mismatch",
        // Masked: the token can be forwarded, and the full address is the
        // invitee's, not the forwardee's. The invitee recognises his own.
        invitedEmail: maskEmail(row.invited_email),
        signedInAs: caller.email,
        error: caller.email
          ? `This invite was sent to ${maskEmail(row.invited_email)}, but you're signed in as ${caller.email}. Sign in with the invited address, or ask the owner to re-invite ${caller.email}.`
          : `This invite was sent to ${maskEmail(row.invited_email)}, and your account has no email address. Sign in with the invited address to accept.`,
      });
    }
    const accepted = await markAccepted(row.id, caller.sub);
    if (!accepted.ok) return json({ error: `Could not accept (${accepted.status})` }, 502);
    return json({ success: true, projectId: row.project_id });
  }

  // ── listPending ─────────────────────────────────────────────────────────────
  // The invites waiting for the CALLER, matched on his GoTrue-verified email.
  // This is the recovery path that does not depend on the emailed link
  // surviving a sign-in: on iPhone the https link opens Safari (no
  // associatedDomains), a brand-new account's pre-session wipe clears the
  // stashed token, and nothing replayed it — so a first-time foreman finished
  // onboarding into an empty app and the GC's roster said "Invited" forever.
  // Home lists these and accepts by id (acceptPending). Service role, because
  // the invitee cannot read the project row or the inviter's profile until he
  // has accepted; the email match is the whole authorisation.
  if (action === "listPending") {
    if (!caller.email) return json({ success: true, invites: [] });
    const r = await rest(
      `project_collaborators?invited_email=eq.${encodeURIComponent(caller.email)}&status=eq.pending&select=id,project_id,role,invited_by,invited_at&order=invited_at.desc&limit=20`,
    );
    if (!r.ok) return json({ error: `Could not load invites (${r.status})` }, 502);
    const rows = (await r.json()) as { id: string; project_id: string; role: string; invited_by: string; invited_at: string }[];
    const invites: { collaboratorId: string; projectId: string; projectName: string; role: string; invitedBy: string; invitedAt: string }[] = [];
    for (const row of rows) {
      let projectName = "";
      let ownerId = "";
      try {
        const pr = await rest(`projects?id=eq.${encodeURIComponent(row.project_id)}&select=name,user_id&limit=1`);
        if (pr.ok) {
          const p = ((await pr.json()) as { name?: string; user_id?: string }[])[0];
          projectName = p?.name ?? "";
          ownerId = p?.user_id ?? "";
        }
      } catch { /* name is decoration; the id still accepts */ }
      // An invite to a project the caller now owns (or that was deleted) is
      // not something he can act on.
      if (!ownerId || ownerId === caller.sub) continue;
      let invitedBy = "";
      try {
        const prof = await rest(`profiles?id=eq.${encodeURIComponent(row.invited_by)}&select=name,company_name&limit=1`);
        if (prof.ok) {
          const p = ((await prof.json()) as { name?: string; company_name?: string }[])[0];
          invitedBy = (p?.company_name || p?.name || "").trim();
        }
      } catch { /* optional */ }
      invites.push({ collaboratorId: row.id, projectId: row.project_id, projectName, role: row.role, invitedBy, invitedAt: row.invited_at });
    }
    return json({ success: true, invites });
  }

  // ── acceptPending ───────────────────────────────────────────────────────────
  // Accept one of listPending's rows by id — the same email check `accept`
  // makes on a token, without needing the token.
  if (action === "acceptPending") {
    const collaboratorId = String(body.collaboratorId || "");
    if (!collaboratorId) return json({ error: "Missing collaboratorId" }, 400);
    const look = await rest(`project_collaborators?id=eq.${encodeURIComponent(collaboratorId)}&status=eq.pending&select=id,project_id,invited_email&limit=1`);
    if (!look.ok) return json({ error: "Lookup failed" }, 502);
    const row = ((await look.json()) as { id: string; project_id: string; invited_email: string }[])[0];
    // Same answer for "no such row" and "not yours": an id is not a secret,
    // but which ids exist for which addresses is nobody else's business.
    if (!row || !caller.email || row.invited_email.toLowerCase() !== caller.email) {
      return json({ success: false, code: "invalid_or_used", error: "This invite is no longer waiting for you. Pull down to refresh." });
    }
    const accepted = await markAccepted(row.id, caller.sub);
    if (!accepted.ok) return json({ error: `Could not accept (${accepted.status})` }, 502);
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
