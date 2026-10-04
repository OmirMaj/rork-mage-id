// utils/signOutTiming.ts — how long Sign Out is allowed to wait, and for what.
//
// Pure: no imports, no storage, no network. contexts/AuthContext.tsx (the
// order of the steps) and lib/supabase.ts (the /logout request itself) both
// read their rules from here, and scripts/validate-w5-join-core-delete.ts
// executes them.
//
// WHY IT EXISTS. "Logging out takes too long." Sign-out was four awaits in a
// row — flush the queues (20 s ceiling), release the push token (3 s ceiling),
// `supabase.auth.signOut()` (NO ceiling), wipe — and on a jobsite connection
// that answers nothing, every one of them ran to its limit. The unbounded one
// was the worst: a /logout request with no reply sat until the OS gave up
// (about a minute on iOS), and it sat INSIDE supabase-js's auth lock, so the
// local fallback behind it could not even start.
//
// And the fallback was not what its comment said. In the installed auth-js
// (2.103) `signOut({ scope: 'local' })` still POSTs /logout?scope=local, and
// when that request fails for a network reason it returns the error WITHOUT
// removing the session. Offline, both attempts failed and the token stayed in
// storage under a logged-out UI.
//
// THE RULES
//   1. The flush and the push-token release both need the live session and do
//      not depend on each other: they run side by side, and BOTH settle (or
//      hit their own ceiling) before the session is signed out.
//   2. The /logout request is bounded (SIGN_OUT_NETWORK_CEILING_MS) at the
//      fetch layer, so the auth lock is released when the bound is hit.
//   3. A scope=local /logout that cannot reach the server — or that the
//      server answers with an error — is ANSWERED LOCALLY with the "session
//      not found" reply auth-js already treats as "remove the session". The
//      local session always dies on this device.
//   4. Once a /logout has gone unanswered, the local one that follows does not
//      try the network again (LOGOUT_UNREACHABLE_MEMORY_MS).
//   5. Offline (as far as the app can tell): nothing that only waits on the
//      network is started — no push-token release, no global sign-out. The
//      queue flush still runs: with no network its requests fail at once, and
//      if the offline flag was wrong the work is saved.

/** The longest one /logout request may take before it is aborted. */
export const SIGN_OUT_NETWORK_CEILING_MS = 4000;

/** How long "the server did not answer a /logout" is remembered. Long enough
 *  to cover the local fallback that follows a failed global sign-out; short
 *  enough that a later, unrelated sign-out tries the network again. */
export const LOGOUT_UNREACHABLE_MEMORY_MS = 15_000;

export type LogoutScope = 'global' | 'local' | 'others';

/** The scope a GoTrue /logout URL asks for. No scope = global, as the server reads it. */
export function logoutScopeOf(url: string): LogoutScope {
  const m = /[?&]scope=([a-z]+)/.exec(url);
  if (m && (m[1] === 'local' || m[1] === 'others')) return m[1];
  return 'global';
}

/** Is this URL GoTrue's sign-out endpoint? */
export function isLogoutUrl(url: string): boolean {
  return /\/auth\/v1\/logout(?:\?|$)/.test(url);
}

/** Before a /logout leaves: send it, or answer it here.
 *  Only a LOCAL sign-out is ever answered without the network, and only right
 *  after a /logout already went unanswered (or the caller said the device is
 *  offline). A global one is always sent: it is the only thing that revokes
 *  the session on the server. */
export function logoutRequestPlan(input: { scope: LogoutScope; msSinceUnreachable: number | null }): 'send' | 'answer-locally' {
  if (input.scope !== 'local') return 'send';
  const ms = input.msSinceUnreachable;
  if (ms !== null && ms >= 0 && ms < LOGOUT_UNREACHABLE_MEMORY_MS) return 'answer-locally';
  return 'send';
}

/** A /logout got no reply (network error, or the ceiling aborted it).
 *  Local: answer it here, so the session is removed from this device.
 *  Global / others: the caller hears the failure and falls back to local. */
export function logoutFailurePlan(scope: LogoutScope): 'answer-locally' | 'rethrow' {
  return scope === 'local' ? 'answer-locally' : 'rethrow';
}

/** A /logout got a reply. A LOCAL sign-out exists to remove the session from
 *  this device, so a server that answers it with an error (a 500, a 429) must
 *  not be what keeps the session here: that reply is replaced with the local
 *  answer. A global one is passed on as it came — the caller has to know the
 *  revoke did not happen. */
export function logoutReplyPlan(input: { scope: LogoutScope; ok: boolean }): 'pass' | 'answer-locally' {
  return input.scope === 'local' && !input.ok ? 'answer-locally' : 'pass';
}

/** What Sign Out starts, given what the app knows about the connection. */
export interface SignOutPlan {
  /** Clear this phone's push token from the profile (needs the session and the network). */
  releasePushToken: boolean;
  /** Ask the server to revoke the session everywhere before removing it here. */
  tryGlobal: boolean;
}
export function planSignOut(input: { offline: boolean }): SignOutPlan {
  return input.offline
    ? { releasePushToken: false, tryGlobal: false }
    : { releasePushToken: true, tryGlobal: true };
}

/** What the Sign Out button says while it is busy. 'saving' only while there
 *  is queued work the flush is trying to land; everything after is 'signing-out'. */
export type SignOutPhase = 'saving' | 'signing-out';
export function signOutPhaseAtStart(pendingCount: number): SignOutPhase {
  return pendingCount > 0 ? 'saving' : 'signing-out';
}
export function signOutBusyLabel(phase: SignOutPhase | null | undefined): string {
  return phase === 'saving' ? 'Saving changes…' : 'Signing out…';
}
