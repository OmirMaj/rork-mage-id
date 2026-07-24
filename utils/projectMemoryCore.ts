// utils/projectMemoryCore.ts — pure, react-native-free helpers for project
// memory retrieval. Split from projectMemory.ts (which imports mageAI/supabase
// and therefore the RN runtime) so plain `bun` validators can import these
// directly — same pattern as aiRateLimiterCore vs aiRateLimiter.

export interface MemoryAskOptions {
  /** Memory doc ids (e.g. `rfi-<id>`) to exclude from retrieval AND citations —
   *  used so an RFI's own indexed question can't be retrieved as its answer. */
  excludeDocIds?: string[];
  /** Citation refs (e.g. `RFI #12`) to exclude — belt-and-braces alongside ids,
   *  since the pgvector index may hold a stale doc id for the same record. */
  excludeRefs?: string[];
  /** AIFeature id forwarded to the mageAI relay for server-side gating/audit. */
  feature?: string;
}

/** Pure: should this record be dropped from retrieval? Works on both client
 *  MemoryDocs ({id, ref}) and server matches ({doc_id, ref}). */
export function isExcludedMemoryRecord(
  rec: { id?: string; doc_id?: string; ref?: string },
  excludeDocIds?: string[],
  excludeRefs?: string[],
): boolean {
  const id = rec.doc_id ?? rec.id;
  if (id && (excludeDocIds ?? []).includes(id)) return true;
  if (rec.ref && (excludeRefs ?? []).includes(rec.ref)) return true;
  return false;
}
