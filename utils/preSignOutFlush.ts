// utils/preSignOutFlush.ts — writes that live ABOVE the offline queue and must
// reach it before a session ends.
//
// AuthContext sits above ProjectProvider in the tree, so it cannot call
// ProjectContext's flushPendingProjectSyncs directly. A project edit is held
// in an 800 ms debounce that is NOT in the offline queue yet; signing out (or
// switching account) inside that window flushed the queue without it and the
// wipe then dropped the edit (session-load-integrity handoff #3). Providers
// below Auth register their "send what you are holding now" function here;
// AuthContext runs them first, then drains the queues.
//
// Module-level on purpose: one app, one set of live providers. Each
// registration returns its own unregister, so a remount never leaves a stale
// closure behind.

type Flush = () => Promise<void>;
const flushes = new Set<Flush>();

export function registerPreSignOutFlush(fn: Flush): () => void {
  flushes.add(fn);
  return () => { flushes.delete(fn); };
}

/** Run every registered flush; one that throws never skips the others. */
export async function runPreSignOutFlushes(): Promise<void> {
  await Promise.all([...flushes].map(fn => fn().catch((err) => {
    console.log('[preSignOutFlush] a pre-sign-out flush failed:', err);
  })));
}
