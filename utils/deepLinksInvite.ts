// utils/deepLinksInvite.ts — carrying a collaboration invite through sign-in.
//
// WHY (audit round 2 #29). app/accept-invite.tsx saved the token under
// 'mageid_pending_invite' and sent the invitee to /login. Nothing ever read
// that key back: login routed to Summary, signup to onboarding, and the
// post-login replay in app/_layout.tsx only reads the pending-deep-link key.
// On a device with no previous user the pre-session wipe also sweeps every
// 'mageid_' key, the saved token included — and the stashed deep link keeps
// only the PATH, so it could not have carried `?token=` either. A first-time
// foreman signed up, finished onboarding into an empty app, and assumed the GC
// never added him.
//
// The token now rides the NAVIGATION instead of storage: accept-invite pushes
// /login?invite=<token>, login and signup hand it on, and a successful sign-in
// lands back on /accept-invite?token=<token>. Nothing to wipe, nothing to
// replay. The server-side recovery (Home's pending-invite card, fed by
// project-invite `listPending`) covers every path this cannot — a web OAuth
// redirect that reloads the page, a link opened in Safari and an account
// created in the app, an invite whose email was lost.
//
// Pure — no React Native imports — so scripts/validate-collaborator-invite-
// recovery.ts can run it.

/** The query param login / signup carry the token in. */
export const INVITE_PARAM = 'invite';

/**
 * A real invite token is two uuids with the dashes removed
 * (project-invite newToken): 64 lowercase hex. Anything else is dropped rather
 * than spliced into a route — the value comes from a URL anyone can type.
 */
export function sanitizeInviteToken(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(t) ? t : null;
}

/** Where accept-invite's "Sign in to accept" goes, token attached. */
export function loginHrefForInvite(token: unknown): string {
  const t = sanitizeInviteToken(token);
  return t ? `/login?${INVITE_PARAM}=${t}` : '/login';
}

/** Where login's "create an account" link goes, keeping the token. */
export function signupHrefForInvite(token: unknown): string {
  const t = sanitizeInviteToken(token);
  return t ? `/signup?${INVITE_PARAM}=${t}` : '/signup';
}

/**
 * Where a successful sign-in (or sign-up with a live session) lands: back on
 * the invite when one came along, otherwise the screen's usual destination.
 * accept-invite is exempt from the persona / onboarding gates, so a brand-new
 * account accepts FIRST and is walked through onboarding after — the project
 * is already in his list when he gets to Home.
 */
export function postSignInHref(token: unknown, fallback: string): string {
  const t = sanitizeInviteToken(token);
  return t ? `/accept-invite?token=${t}` : fallback;
}

/** One invite waiting for the signed-in user (project-invite `listPending`). */
export interface PendingInvite {
  collaboratorId: string;
  projectId: string;
  projectName: string;
  role: string;
  invitedBy: string;
  invitedAt: string;
}

const ROLE_WORD: Record<string, string> = { editor: 'Editor', viewer: 'Viewer', field: 'Field' };

/**
 * "Mike's Construction invited you to Henderson Remodel as Field". Names only
 * what the server returned — a missing company or project name reads as
 * "A contractor" / "a project", never a guess.
 */
export function pendingInviteHeadline(inv: Pick<PendingInvite, 'invitedBy' | 'projectName' | 'role'>): string {
  const who = inv.invitedBy.trim() || 'A contractor';
  const what = inv.projectName.trim() || 'a project';
  const role = ROLE_WORD[inv.role];
  return role ? `${who} invited you to ${what} as ${role}` : `${who} invited you to ${what}`;
}

/** Keep only well-formed rows from the edge function's reply. */
export function parsePendingInvites(body: unknown): PendingInvite[] {
  const list = (body as { invites?: unknown } | null)?.invites;
  if (!Array.isArray(list)) return [];
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return list
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        collaboratorId: str(o.collaboratorId), projectId: str(o.projectId), projectName: str(o.projectName),
        role: str(o.role), invitedBy: str(o.invitedBy), invitedAt: str(o.invitedAt),
      };
    })
    .filter((r) => r.collaboratorId !== '' && r.projectId !== '');
}
