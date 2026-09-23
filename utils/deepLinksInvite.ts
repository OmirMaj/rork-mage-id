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
 * account accepts FIRST. Since #93 an invite-first account still answers the
 * persona question but SKIPS the GC onboarding, and the pending deep link
 * replays him onto the project he was invited to.
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

// ── The invite that rides the ACCOUNT (#107 / #131) ──────────────────────────
//
// The navigation above cannot survive an email sign-up: Supabase's
// confirmation link is a NEW navigation — a new Safari tab, the Mail app's
// in-app browser, another device — and it lands on the app's root with no
// token. So signup() also writes the sanitized token into the new account's
// user_metadata (`invite_token`), which every one of those tabs gets back with
// the session. The root gate in app/_layout.tsx sends an authenticated user
// with no persona yet and a live metadata token to /accept-invite?token=…
// before the persona / onboarding gates run; accept-invite clears it once the
// server has answered for good (accepted, used, or addressed to someone else).
//
// Deliberately not emailRedirectTo: a redirect URL that is not on the Supabase
// Auth allow-list is silently replaced by the Site URL (the marketing site),
// which would strand him somewhere worse than today.

/** The metadata key signup() writes the token under. */
export const INVITE_METADATA_FIELD = 'invite_token';

/** A live invite token carried on the account, or null. */
export function inviteTokenFromMetadata(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  return sanitizeInviteToken((meta as Record<string, unknown>)[INVITE_METADATA_FIELD]);
}

/** What signUp's `options.data` carries: the name, plus the token when real. */
export function signupMetadata(name: string, inviteToken?: unknown): Record<string, string> {
  const t = sanitizeInviteToken(inviteToken);
  return t ? { name, [INVITE_METADATA_FIELD]: t } : { name };
}

// Tokens this JS process has already routed to accept-invite (or that
// accept-invite has settled). Memory only, on purpose: it stops the gate from
// bouncing him back to the invite in a loop when he leaves it with "Go to
// Home", or while the metadata clear is still on its way — and a cold start
// gets exactly one fresh attempt, which is right for a failure that was only
// a dropped connection.
const handledInviteTokens = new Set<string>();

export function markInviteTokenHandled(token: unknown): void {
  const t = sanitizeInviteToken(token);
  if (t) handledInviteTokens.add(t);
}

export function isInviteTokenHandled(token: unknown): boolean {
  const t = sanitizeInviteToken(token);
  return !!t && handledInviteTokens.has(t);
}

/**
 * Where the root gate sends an authenticated user because of the token on his
 * account, or null to fall through to the persona / onboarding gates. Only a
 * brand-new account (no persona picked yet) is redirected: a set-up user who
 * still carries a token is served by Home's pending-invite card instead of
 * being yanked off whatever he opened.
 */
export function metadataInviteRedirect(a: { userRole: unknown; meta: unknown }): string | null {
  if (a.userRole !== null) return null;
  const t = inviteTokenFromMetadata(a.meta);
  if (!t || handledInviteTokens.has(t)) return null;
  return postSignInHref(t, '/(tabs)/(home)');
}

// ── A session that arrives from ANOTHER tab (#108) ───────────────────────────
//
// signup.tsx / login.tsx watch for isAuthenticated flipping false→true while
// they sit on /signup?invite=… or /login?invite=… with no sign-in of their own
// in flight. On the web that flip is supabase-js broadcasting SIGNED_IN from
// another tab of the same origin — classically the tab the confirmation link
// opened. That tab boots fresh, and when the account carries the SAME token
// (signup() wrote it into user_metadata) its root gate opens the invite
// itself (metadataInviteRedirect above). If this tab ALSO navigated, both
// tabs called accept with one token: project-invite looks it up with
// status=pending and nulls it on accept, so the second call — usually the
// tab he is looking at, which had to boot — got invalid_or_used and was then
// walked into the GC onboarding. Exactly one tab may open an invite that
// rides the account: the one the link opened. This one stands down and says
// where the invite went.
//
// What this gives up, stated plainly: an account that already picked a
// persona and still carries the same token is not redirected by the other
// tab's gate either, so nobody opens it automatically — Home's pending-invite
// card (project-invite listPending) is where he accepts it. Native has no
// second tab: a session that arrives there came through this same process,
// whose gate defers to this screen (#93), so native keeps navigating.

export type SignInElsewhereAction = 'open_invite' | 'opened_in_other_tab' | 'none';

export function signInElsewhereAction(a: {
  routeToken: unknown;
  /** The arriving session's user_metadata. */
  accountMeta: unknown;
  /** Other tabs of this origin share the session (web). */
  sharedOriginTabs: boolean;
}): SignInElsewhereAction {
  const route = sanitizeInviteToken(a.routeToken);
  if (!route) return 'none';
  // This process already routed it (the gate, or an earlier run here).
  if (handledInviteTokens.has(route)) return 'none';
  if (a.sharedOriginTabs && inviteTokenFromMetadata(a.accountMeta) === route) return 'opened_in_other_tab';
  return 'open_invite';
}

// ── The root navigator across a sign-in (#7) ─────────────────────────────────
//
// Lives here, beside the invite helpers, because the invite return trip is the
// navigation it exists to protect, and this module is the pure one a validator
// can run.
//
// app/_layout.tsx used to swap the whole <Stack> for the CraneLoader whenever
// the boot queries reloaded — which is every sign-in, because the queries get
// the new account's keys. Unmounting the root navigator throws away the screen
// that was navigating: login's return trip to the invite (postSignInHref) threw
// ("navigate before mounting the Root Layout") or was discarded, and the Stack
// came back at its first route with the ?invite= gone. The invite, the #93
// return trip and login's own landing on Summary were all lost.
//
// The policy now:
//   • first boot — the loader alone, as before (nothing is mounted yet);
//   • afterwards — the Stack STAYS mounted and the loader is drawn over it
//     (the gate already waits while the queries load, so nothing routes early);
//   • one exception, kept deliberately: a DIFFERENT account arriving where
//     another account's screens were mounted (A signed out, B signs in, no
//     reload). Those screens may hold A's state in component memory, so the
//     Stack is torn down and remounted fresh for B — exactly what the loader
//     swap used to do for everyone. `stackOwner` is the last signed-in user
//     the Stack served; it survives a sign-out WHILE the sign-out is still
//     loading, so a B who signs in inside that window is still a switch.
//   • a sign-out, once it has settled (integration round 1): the Stack is
//     remounted under a new key and the owner cleared. Kept mounted, A's
//     screens sat under /login with their component state, and on the web a
//     browser Back rendered them to the signed-out visitor for a frame before
//     the gate bounced him. The invite return trip only needs null → user to
//     keep the Stack, and that path is untouched.

export type RootNavMode = 'loader' | 'stack' | 'stack+overlay';

export interface RootNavState {
  /** The first boot has finished; from here on the Stack is not unmounted for a reload. */
  booted: boolean;
  /** The last signed-in user id the mounted Stack has served (kept through a sign-out). */
  stackOwner: string | null;
  /** Bumped on a switch between two different accounts — the Stack's remount key. */
  generation: number;
}

export const ROOT_NAV_INITIAL: RootNavState = { booted: false, stackOwner: null, generation: 0 };

export function rootNavPresentation(
  prev: RootNavState,
  now: { bootstrapping: boolean; userId: string | null },
): { mode: RootNavMode; next: RootNavState } {
  if (!prev.booted) {
    if (now.bootstrapping) return { mode: 'loader', next: prev };
    return { mode: 'stack', next: { booted: true, stackOwner: now.userId, generation: prev.generation } };
  }
  const switched = now.userId !== null && prev.stackOwner !== null && now.userId !== prev.stackOwner;
  if (switched) {
    // The previous tenant's screens go: the loader while the new account's
    // boot reads run, then a fresh Stack under a new key. A switch that needs
    // no reload at all still remounts, through the key.
    if (now.bootstrapping) return { mode: 'loader', next: prev };
    return { mode: 'stack', next: { booted: true, stackOwner: now.userId, generation: prev.generation + 1 } };
  }
  if (now.userId === null && prev.stackOwner !== null && !now.bootstrapping) {
    // A settled sign-out: the previous account's screens go (see above).
    return { mode: 'stack', next: { booted: true, stackOwner: null, generation: prev.generation + 1 } };
  }
  return {
    mode: now.bootstrapping ? 'stack+overlay' : 'stack',
    next: { booted: true, stackOwner: now.userId ?? prev.stackOwner, generation: prev.generation },
  };
}
