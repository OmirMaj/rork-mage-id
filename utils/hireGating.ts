// utils/hireGating.ts — the launch-flag gate for the Direct-Hire / messaging
// subsystem, isolated as pure logic.
//
// WHY IT'S A SEPARATE MODULE: contexts/HireContext.tsx imports AsyncStorage,
// react-query and the Supabase client, so bun can't load it in a validator
// (react-native won't parse). The *decisions* — may we query, may we sync,
// may we open a Realtime channel, what happens when a mutation is called
// while disabled — live here so scripts/validate-weather-provenance.ts can
// assert them directly instead of regexing JSX.
//
// The flag itself (`HIRE_ENABLED`) still lives in contexts/HireContext.tsx —
// it's the launch switch every consumer screen reads. This module only takes
// it as an argument.
//
// Everything is GATED, never deleted. Flipping HIRE_ENABLED back to true
// restores the whole subsystem with no other edits.

/**
 * react-query `enabled` for every Hire query (jobs, workers, conversations,
 * messages). When false, react-query never invokes the queryFn — so there is
 * no AsyncStorage read and no Supabase round-trip, for any signed-in user, on
 * any app launch.
 */
export function hireQueriesEnabled(hireEnabled: boolean): boolean {
  return hireEnabled;
}

/**
 * Whether Hire may talk to Supabase at all (reads inside the queryFns and
 * writes through the offline queue). Requires the flag AND a signed-in user
 * AND a configured Supabase client — the flag is the outermost gate so a
 * disabled subsystem can never issue a request.
 */
export function hireCanSync(
  hireEnabled: boolean,
  hasUser: boolean,
  supabaseConfigured: boolean,
): boolean {
  return hireEnabled && hasUser && supabaseConfigured;
}

/**
 * Whether to open the `realtime-messages-${userId}` Supabase Realtime channel.
 * A websocket for a subsystem no user can reach is pure waste, so the flag
 * gates it ahead of the existing "must have conversations" rule.
 */
export function hireRealtimeEnabled(
  hireEnabled: boolean,
  canSync: boolean,
  conversationCount: number,
): boolean {
  return hireEnabled && canSync && conversationCount > 0;
}

/**
 * Every Hire mutation is a no-op while the subsystem is off — but a SILENT
 * no-op is worse than none: the caller would believe the job posted / the
 * message sent. Mutations throw this instead, so the failure is visible in
 * dev and reported in prod rather than swallowed.
 *
 * Reads (e.g. getConversationMessages) must NOT throw — app/messages.tsx
 * calls one during render, before its own HIRE_ENABLED guard runs — so they
 * return empty collections instead.
 */
export function hireDisabledError(operation: string): Error {
  return new Error(
    `[HireContext] ${operation}() called while HIRE_ENABLED is false. ` +
      'The Direct-Hire / messaging subsystem is off for launch; nothing was written. ' +
      'Gate the entry point on HIRE_ENABLED, or flip the flag in contexts/HireContext.tsx.',
  );
}
