// utils/authEventHold.ts — hold supabase-js auth events back from React while
// a sign-in decides what to do with the previous tenant's local data.
//
// Why (data-session critic, #72 follow-up): supabase-js fires SIGNED_IN INSIDE
// signUp(), before it resolves, and on the web detectSessionInUrl hands a
// confirmation link's session to the client at construction. Either way the
// provider's onAuthStateChange set `user` at once, ProjectContext started
// hydrating the NEW account, and its loaders merged the PREVIOUS tenant's
// cached local-only rows (still on disk — the tenant wipe had not run yet)
// under the new account. SYNC-F13's rule is "wipe before the session exists";
// for these two paths the session exists before our code runs, so the next
// best thing is: the session exists, but the APP does not see it until the
// handoff is done. Events that arrive while held are not dropped — the latest
// one is applied on release.
//
// Pure (no React, no Supabase) so scripts/validate-auth-event-hold.ts can pin it.

export type AuthEventHold<S> = { depth: number; has: boolean; pending: S | null };

export function createAuthEventHold<S>(): AuthEventHold<S> {
  return { depth: 0, has: false, pending: null };
}

/** Deliver an auth event now, or keep it (the latest wins) while held. */
export function offerAuthEvent<S>(hold: AuthEventHold<S>, session: S | null, apply: (s: S | null) => void): void {
  if (hold.depth > 0) {
    hold.has = true;
    hold.pending = session;
    return;
  }
  apply(session);
}

export function holdAuthEvents<S>(hold: AuthEventHold<S>): void {
  hold.depth += 1;
}

/** End one hold; the last one out applies the newest event kept meanwhile. */
export function releaseAuthEvents<S>(hold: AuthEventHold<S>, apply: (s: S | null) => void): void {
  hold.depth = Math.max(0, hold.depth - 1);
  if (hold.depth > 0 || !hold.has) return;
  const s = hold.pending;
  hold.has = false;
  hold.pending = null;
  apply(s);
}
