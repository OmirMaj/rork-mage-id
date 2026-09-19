// project-memory-embed/planScopeIo.ts — the I/O half of planScope.ts (#161):
// who owns a project, whether the caller may reach it, and the owner's tier.
// Shared by project-memory-embed, project-memory-search and plan-extract.
//
// The caller has already been VERIFIED by requireTier (GoTrue). Everything
// here runs with the service role, which bypasses RLS — so the project id is
// shape-checked before it reaches a filter, and access is decided from the
// same two arms public.can_access_project uses (owner, or an ACCEPTED
// collaborator), which cannot be called here because a service-role
// connection has no auth.uid().

import { planScopeFor, type PlanScope, type Tier } from './planScope.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rest<T>(path: string): Promise<T[] | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) ? rows as T[] : null;
  } catch {
    return null;
  }
}

/**
 * The caller's plan scope on `projectId`, or null when the project is not one
 * they can reach (or the lookup failed — fail CLOSED: a glitch must not hand
 * a stranger the owner's index).
 */
export async function resolvePlanScope(callerId: string, projectId: string): Promise<PlanScope | null> {
  if (!callerId || !UUID_RE.test(projectId)) return null;
  const projects = await rest<{ user_id: string | null }>(`projects?id=eq.${projectId}&select=user_id&limit=1`);
  const ownerId = projects?.[0]?.user_id ?? '';
  if (!ownerId) return null;
  if (ownerId === callerId) return planScopeFor(callerId, { ownerId }, null);
  const collab = await rest<{ role: string }>(
    `project_collaborators?project_id=eq.${projectId}&user_id=eq.${callerId}&status=eq.accepted&select=role&limit=1`,
  );
  return planScopeFor(callerId, { ownerId }, collab?.[0]?.role ?? null);
}

// Keep in sync with _shared/auth.ts MASTER_EMAILS and utils/owner.ts (the same
// duplication mcp/index.ts carries: auth.ts does not export its tier lookup).
const MASTER_EMAILS = new Set<string>(['omirmajeed2000@gmail.com', 'support@mageid.app']);

/**
 * Another user's tier (the project OWNER's), resolved the way _shared/auth.ts
 * resolves the caller's: subscriptions.tier, end_date-aware, the master-email
 * override, and FREE on any uncertainty.
 */
export async function tierOfUser(userId: string): Promise<Tier> {
  if (!userId || !UUID_RE.test(userId)) return 'free';
  let tier: Tier = 'free';
  const rows = await rest<{ tier: string; end_date: string | null }>(
    `subscriptions?user_id=eq.${userId}&select=tier,end_date&order=updated_at.desc&limit=1`,
  );
  const row = rows?.[0];
  if (row && !(row.end_date && new Date(row.end_date).getTime() < Date.now())) {
    if (row.tier === 'enterprise' || row.tier === 'business' || row.tier === 'pro') tier = row.tier;
  }
  if (tier === 'business' || tier === 'enterprise') return tier;
  // Master override — only when the subscription would not already pass.
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    if (r.ok) {
      const u = await r.json() as { email?: string };
      if (u.email && MASTER_EMAILS.has(u.email.toLowerCase())) return 'business';
    }
  } catch { /* stays at the subscription tier */ }
  return tier;
}
