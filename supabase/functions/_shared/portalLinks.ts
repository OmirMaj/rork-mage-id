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
// Callers pass the raw `client_portal` jsonb from the projects row.

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
 */
export function portalUrlFor(clientPortal: unknown): string | null {
  const cp = (clientPortal ?? {}) as ClientPortalLike;
  if (cp.enabled === false) return null;
  const portalId = typeof cp.portalId === 'string' ? cp.portalId.trim() : '';
  const token = typeof cp.accessToken === 'string' ? cp.accessToken.trim() : '';
  if (!portalId || !token) return null;
  return `${PORTAL_BASE}/${encodeURIComponent(portalId)}?t=${encodeURIComponent(token)}`;
}

/** Sub-portal URL from a sub_portal_links row (`id`, `access_token`, `enabled`). */
export function subPortalUrlFor(link: { id?: string | null; access_token?: string | null; enabled?: boolean | null } | null | undefined): string | null {
  if (!link || link.enabled === false) return null;
  const id = typeof link.id === 'string' ? link.id.trim() : '';
  const token = typeof link.access_token === 'string' ? link.access_token.trim() : '';
  if (!id || !token) return null;
  return `${SUB_PORTAL_BASE}/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;
}
