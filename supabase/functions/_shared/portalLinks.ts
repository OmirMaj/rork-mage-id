// _shared/portalLinks.ts
//
// The ONE place a customer-facing portal URL is built. The static portal page
// (marketing/portal/index.html) identifies a portal by the minted id stored at
// projects.client_portal->>'portalId' (shape `portal-<id8>-<ts36>`) and reads
// its access token from the `?t=` query param; every RPC it calls refuses a
// request without that token. A URL built from projects.id, or without `?t=`,
// lands on the fallback page ("This portal isn't available") — which is what
// every system email did before 2026-09-04 (audit EDGE-F6).
//
// Callers pass the raw `client_portal` jsonb from the projects row AND the key
// read from public.portal_credentials (storedPortalKey below). The key left the
// projects row with 20261005100000_portal_token_strip.sql (#82): every accepted
// collaborator can read that row, and the key is all the client page checks
// before it records the client's e-signature. A caller that passes only the
// row builds no link at all once that migration is applied.

export const PORTAL_BASE = 'https://mageid.app/portal';
export const SUB_PORTAL_BASE = 'https://mageid.app/sub-portal';
export const APP_BASE = 'https://app.mageid.app';

export interface ClientPortalLike {
  enabled?: boolean | null;
  portalId?: string | null;
  accessToken?: string | null;
}

/**
 * Homeowner portal URL for a project, or null when the portal is not enabled
 * or has no minted id / token (in which case callers must fall back to
 * APP_BASE or omit the CTA — never emit a dead link).
 *
 * `storedKey` is the key from portal_credentials (storedPortalKey). It wins
 * over a copy still on the row: the credentials row is the one the client
 * page's gate compares with, so after a Reset link the row's copy is the dead
 * one. The row's copy is only the fallback for a database where
 * 20261005100000 is not applied yet.
 */
export function portalUrlFor(clientPortal: unknown, storedKey?: string | null): string | null {
  const cp = (clientPortal ?? {}) as ClientPortalLike;
  if (cp.enabled === false) return null;
  const portalId = typeof cp.portalId === 'string' ? cp.portalId.trim() : '';
  const stored = typeof storedKey === 'string' ? storedKey.trim() : '';
  const token = stored || (typeof cp.accessToken === 'string' ? cp.accessToken.trim() : '');
  if (!portalId || !token) return null;
  return `${PORTAL_BASE}/${encodeURIComponent(portalId)}?t=${encodeURIComponent(token)}`;
}

/**
 * The key public.portal_credentials holds for this project's CURRENT portal id,
 * read with the service role (the table has no policy for anyone but the
 * project's owner). null = no key stored for that portal id, the read failed,
 * or the function has no service key — the caller's portalUrlFor then falls
 * back to the row's own copy, and to no link at all when there is none. Never
 * throws, never logs the key.
 *
 * A row whose portal_id is not the one on the project is a key for a portal
 * that no longer exists; it is not returned.
 */
export async function storedPortalKey(projectId: unknown, clientPortal: unknown): Promise<string | null> {
  const cp = (clientPortal ?? {}) as ClientPortalLike;
  const portalId = typeof cp.portalId === 'string' ? cp.portalId.trim() : '';
  const pid = typeof projectId === 'string' ? projectId.trim() : '';
  if (!pid || !portalId || cp.enabled === false) return null;
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !service) return null;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/portal_credentials?project_id=eq.${encodeURIComponent(pid)}&select=portal_id,access_token&limit=1`,
      { headers: { apikey: service, Authorization: `Bearer ${service}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { portal_id?: string | null; access_token?: string | null }[];
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || row.portal_id !== portalId) return null;
    const key = typeof row.access_token === 'string' ? row.access_token.trim() : '';
    return key || null;
  } catch {
    return null;
  }
}

/**
 * True when the portal's link has ENDED: portal_snapshots.expires_at (keyed by
 * the minted portal id) is in the past. portalUrlFor cannot know this — the
 * expiry lives on the snapshot row, not in client_portal — so every caller
 * that puts the link in a system email reads expires_at and drops the CTA when
 * this is true: a link that no longer opens is a dead end, the same as none.
 * No expiry (null / unparseable) = still open.
 */
export function portalLinkEnded(expiresAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) && ms <= nowMs;
}

/** Sub-portal URL from a sub_portal_links row (`id`, `access_token`, `enabled`). */
export function subPortalUrlFor(link: { id?: string | null; access_token?: string | null; enabled?: boolean | null } | null | undefined): string | null {
  if (!link || link.enabled === false) return null;
  const id = typeof link.id === 'string' ? link.id.trim() : '';
  const token = typeof link.access_token === 'string' ? link.access_token.trim() : '';
  if (!id || !token) return null;
  return `${SUB_PORTAL_BASE}/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;
}
