// ============================================================================
// utils/portalReady.ts — can the homeowner actually RECEIVE this? (Lane 0)
//
// app/contract.tsx used to flip a contract to 'sent', flip the job to
// in_progress, and only THEN work out whether anyone could receive the email,
// mentioning "nothing was emailed" in the alert afterwards. The four branches
// that decided it are lifted here unchanged, so C1 can ask the same question
// BEFORE the signature pad opens, and contract.tsx asks it after the flip with
// the same answer:
//
//   'collaborator'   — this account is not the job's owner. The portal's
//                      signing key is stripped for collaborators on purpose
//                      (AUTH-F5), and client-portal-setup refuses to heal or
//                      write a portal for them. Only the owner can send.
//   'no_email'       — no portal invitee with an '@' (checked before the
//                      portal state, exactly as contract.tsx did);
//   'no_signing_key' — the portal is on (enabled + portalId) but has no
//                      accessToken yet. A DB trigger mints it; the heal path
//                      is client-portal-setup.tsx (never copy it);
//   'portal_off'     — anything else: the portal is off or was never set up;
//   'ready'          — a portal link with its ?t= token (portalShareUrl) and
//                      at least one invitee email. Only then may a contract be
//                      signed-and-sent.
//
// portalDeliveryFacts gives the individual facts, because C1's one sheet may
// need two of them at once (no email AND portal off → ask for the email and
// say what turning the portal on shows the client, in one step).
//
// Pure: no React, no RN, no storage. scripts/validate-ux-portal-ready.ts runs
// it under bun and pins contract.tsx to it.
// ============================================================================

import type { ClientPortalSettings, Project } from '@/types';
import { portalShareUrl } from '@/utils/portalSnapshot';

export type PortalDeliveryState = 'ready' | 'no_email' | 'portal_off' | 'no_signing_key' | 'collaborator';

type ProjectLike = Pick<Project, 'clientPortal' | 'ownerUserId'> | null | undefined;

export type PortalOwnership = 'owner' | 'collaborator' | 'unknown';

/**
 * Who holds this job's portal, from the cached owner id. Mirrors
 * client-portal-setup.tsx's local portalOwnershipOf: 'unknown' when either
 * id is missing (a cache predating ownerUserId, or no session) — unknown is
 * NOT treated as a collaborator here; the server still refuses a
 * collaborator's portal write, and client-portal-setup confirms ownership
 * from user_id before healing.
 */
export function portalOwnershipOf(ownerUserId: string | null | undefined, userId: string | null | undefined): PortalOwnership {
  if (!ownerUserId || !userId) return 'unknown';
  return ownerUserId === userId ? 'owner' : 'collaborator';
}

/** The invitees a portal email can go to: an '@' in the trimmed address.
 *  The exact filter contract.tsx has always used. */
export function portalRecipients(
  portal: Pick<ClientPortalSettings, 'invites'> | null | undefined,
): { email: string; name: string }[] {
  return (portal?.invites ?? [])
    .filter(i => (i.email ?? '').trim().includes('@'))
    .map(i => ({ email: i.email!.trim(), name: i.name }));
}

export interface PortalDeliveryFacts {
  isCollaborator: boolean;
  hasEmail: boolean;
  /** enabled !== false and a portalId — the portal page exists. */
  portalOn: boolean;
  /** portalShareUrl returned a link (portal on, id AND token). */
  hasSigningLink: boolean;
}

export function portalDeliveryFacts(project: ProjectLike, userId?: string | null): PortalDeliveryFacts {
  const portal = project?.clientPortal;
  return {
    isCollaborator: portalOwnershipOf(project?.ownerUserId, userId) === 'collaborator',
    hasEmail: portalRecipients(portal).length > 0,
    portalOn: !!(portal?.enabled && portal.portalId),
    hasSigningLink: !!(project && portalShareUrl(portal)),
  };
}

/**
 * The one answer. Order: collaborator first (nothing he can do fixes it),
 * then contract.tsx's four branches in their original order.
 */
export function portalDeliveryState(project: ProjectLike, userId?: string | null): PortalDeliveryState {
  const f = portalDeliveryFacts(project, userId);
  if (f.isCollaborator) return 'collaborator';
  if (f.hasSigningLink && f.hasEmail) return 'ready';
  if (!f.hasEmail) return 'no_email';
  if (f.portalOn) return 'no_signing_key';
  return 'portal_off';
}

// ── C1's delivery marker (decision: LOCAL, recorded in the plan's Lane 0) ───
// "Signed by you, not delivered" must survive a reload on this device without
// a migration (OTA only). It is a per-device record, stamped with the user id
// like utils/activeProject's keys, under the `mageid_` prefix so the tenant
// sweep removes it. A second device has no marker, so the contract screen's
// status line must never claim receipt on its own ("Sent to the homeowner"
// is only said when this device saw the email go out); see the plan note.

export const CONTRACT_DELIVERY_KEY_PREFIX = 'mageid_contract_delivery:';

export function contractDeliveryKey(contractId: string): string {
  return `${CONTRACT_DELIVERY_KEY_PREFIX}${contractId}`;
}

export type ContractDelivery =
  | { state: 'delivered'; at: string; count: number }
  | { state: 'not_delivered'; at: string; reason: PortalDeliveryState | 'send_failed' };

export function stampContractDelivery(uid: string, d: ContractDelivery): string {
  return JSON.stringify({ uid, ...d });
}

/** The stored marker, or null when absent, malformed, or another user's. */
export function readContractDelivery(raw: string | null | undefined, uid: string | null | undefined): ContractDelivery | null {
  if (!raw || !uid) return null;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r.uid !== uid || typeof r.at !== 'string' || !r.at) return null;
  if (r.state === 'delivered') {
    const count = typeof r.count === 'number' && Number.isFinite(r.count) && r.count > 0 ? Math.floor(r.count) : 0;
    return count > 0 ? { state: 'delivered', at: r.at, count } : null;
  }
  if (r.state === 'not_delivered') {
    const reasons: readonly string[] = ['ready', 'no_email', 'portal_off', 'no_signing_key', 'collaborator', 'send_failed'];
    if (typeof r.reason !== 'string' || !reasons.includes(r.reason)) return null;
    return { state: 'not_delivered', at: r.at, reason: r.reason as PortalDeliveryState | 'send_failed' };
  }
  return null;
}
