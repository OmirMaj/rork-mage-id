// project-memory-embed/indexDiff.ts — pure. The decision half of the
// incremental index (audit round 2, #23): given what the client says exists
// NOW and what memory_embeddings holds, which docs need embedding and which
// rows point at records that are gone.
//
// Zero Deno / network imports so scripts/validate-project-memory-sync.ts can
// run it under bun — the function file only does the I/O around it.
//
// Identity is the BASE doc id: a plan sheet longer than one chunk is stored as
// `plan-sheet:<id>#0`, `#1`, … and all of its chunks share the sheet's hash.
// The client's manifest names the base once; every chunk row answers to it.

export interface ManifestEntry { doc_id: string; hash: string }
export interface IndexRow { doc_id: string; content_hash: string | null }

/** `plan-sheet:abc#2` → `plan-sheet:abc`; ids with no chunk suffix are their own base. */
export function baseDocId(docId: string): string {
  const m = /^(.*)#\d+$/.exec(docId);
  return m ? m[1] : docId;
}

/**
 * Past this share of the in-scope index, a prune is refused rather than run.
 *
 * WHY: the manifest is built from whatever the client has in memory. A screen
 * that syncs while ProjectContext is still hydrating (daily reports loaded,
 * RFIs not yet) would otherwise delete most of the index, and the next open
 * would pay Gemini — and the user's monthly memory allowance — to put it all
 * back. The trade is deliberate: if the user really did delete more than half
 * of a large project's records, those rows stay citable (the response says
 * `pruneRefused`, so it is visible) — a stale citation of a record that did
 * exist, against re-paying for the whole index on every half-loaded open.
 */
export const MAX_PRUNE_SHARE = 0.5;
/** Small indexes can always be pruned — a 3-record project deleting 2 is normal. */
export const PRUNE_ALWAYS_OK_BELOW = 20;
/**
 * A scope prefix that is indexed this many times or more, and that the manifest
 * does not mention AT ALL, is read as "that record type has not hydrated yet"
 * and refuses the prune.
 *
 * WHY a second guard: the share guard only catches a LARGE shortfall. Project
 * Memory's five collections each land from their own query (ProjectContext
 * hydrates rfis, dailyReports, changeOrders, submittals and punchItems
 * separately), so a manifest built mid-hydration is never missing a random 27%
 * — it is missing WHOLE TYPES. 240 of 330 records loaded, the 90 submittals
 * still in flight, is a 27% shortfall: under the share guard, so the index's
 * 90 submittal rows were deleted and the next open paid Gemini and the user's
 * monthly memory allowance to put them back. The shape of the gap is the
 * signal, not its size.
 *
 * The threshold keeps a genuine small clear-out working: a project with three
 * submittals that deletes all three is under it and still prunes.
 */
export const WHOLE_TYPE_PRUNE_GUARD_MIN = 5;

export interface IndexDiff {
  /** Base ids whose row is missing, has no hash (pre-hash rows), or has a different hash. */
  stale: string[];
  /** Base ids that are indexed with the hash the client has — nothing to send. */
  fresh: string[];
  /** Row doc_ids (chunk ids included) whose base is not in the manifest. */
  prune: string[];
  /** True when `prune` was non-empty but refused by the share guard. */
  pruneRefused: boolean;
}

export function diffIndex(
  manifest: readonly ManifestEntry[],
  rows: readonly IndexRow[],
  opts: { prune: boolean; scopePrefixes?: readonly string[] },
): IndexDiff {
  // Every chunk of a base must carry the manifest hash; one stale chunk makes
  // the whole base stale (a re-extract rewrites every chunk anyway).
  const rowHashes = new Map<string, Set<string | null>>();
  for (const r of rows) {
    const base = baseDocId(r.doc_id);
    const set = rowHashes.get(base) ?? new Set<string | null>();
    set.add(r.content_hash ?? null);
    rowHashes.set(base, set);
  }

  const wanted = new Map<string, string>();
  for (const m of manifest) {
    if (!m || typeof m.doc_id !== 'string' || !m.doc_id) continue;
    wanted.set(baseDocId(m.doc_id), String(m.hash ?? ''));
  }

  const stale: string[] = [];
  const fresh: string[] = [];
  for (const [base, hash] of wanted) {
    const have = rowHashes.get(base);
    const isFresh = !!hash && !!have && have.size === 1 && have.has(hash);
    (isFresh ? fresh : stale).push(base);
  }

  let prune: string[] = [];
  let pruneRefused = false;
  if (opts.prune) {
    prune = rows.map(r => r.doc_id).filter(id => !wanted.has(baseDocId(id)));
    const indexedBases = rowHashes.size;
    const goneBases = new Set(prune.map(baseDocId)).size;
    if (goneBases > 0 && indexedBases >= PRUNE_ALWAYS_OK_BELOW && goneBases / indexedBases > MAX_PRUNE_SHARE) {
      prune = [];
      pruneRefused = true;
    }
    // A whole record type missing from the manifest is a half-hydrated client,
    // not a delete (see WHOLE_TYPE_PRUNE_GUARD_MIN). Refuse the WHOLE prune,
    // not just that type's rows: a manifest that is missing one collection is
    // not evidence about any of the others either.
    if (prune.length > 0) {
      for (const prefix of opts.scopePrefixes ?? []) {
        const indexedOfType = [...rowHashes.keys()].filter(b => b.startsWith(prefix)).length;
        const claimedOfType = [...wanted.keys()].filter(b => b.startsWith(prefix)).length;
        if (claimedOfType === 0 && indexedOfType >= WHOLE_TYPE_PRUNE_GUARD_MIN) {
          prune = [];
          pruneRefused = true;
          break;
        }
      }
    }
  }
  return { stale, fresh, prune, pruneRefused };
}

/**
 * Rows left behind when a doc was re-sent with fewer chunks: same base as an
 * incoming doc, but a doc_id this batch did not write. (A sheet that shrank
 * from `#0,#1` to a single un-suffixed doc would otherwise keep its old `#1`
 * chunk — text from a drawing that no longer says that.)
 */
export function orphanedChunks(incomingDocIds: readonly string[], rows: readonly IndexRow[]): string[] {
  const incoming = new Set(incomingDocIds);
  const bases = new Set(incomingDocIds.map(baseDocId));
  return rows
    .map(r => r.doc_id)
    .filter(id => bases.has(baseDocId(id)) && !incoming.has(id));
}
