// utils/plans/memoryIndexCore.ts — pure. The client half of the incremental
// memory_embeddings index shared by Ask Your Plans (plan-sheet:<id> docs) and
// Project Memory (rfi-/dfr-/co-/sub-/punch- docs), plus the honest wording of
// an indexing run. React/RN-free so scripts/validate-plan-ask-honesty.ts and
// scripts/validate-project-memory-sync.ts can execute it under bun.
//
// It lives beside the plan helpers because Ask Your Plans is where the index
// first lied (audit round 2, #19: 0 sheets indexed on web, label green
// "Indexing complete"); Project Memory (#23) reuses the same hashing and
// batching so the two surfaces cannot drift on what "indexed" means.

// ── Hashing ─────────────────────────────────────────────────────────────────

/**
 * cyrb53 — a fast 53-bit string hash, hex-encoded. NOT cryptographic: it only
 * has to tell "the text this row was embedded from" apart from "the text the
 * record has now". A collision costs one stale row until the record changes
 * again; 53 bits makes that vanishingly rare across one project's records.
 */
export function hashText(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** What a project-memory row was embedded from: source + citation label + text.
 *  The ref is part of it because a renumbered RFI must re-cite correctly. */
export function memoryDocHash(doc: { source: string; ref: string; text: string }): string {
  return hashText(`${doc.source}\u0000${doc.ref}\u0000${doc.text}`);
}

/**
 * A plan sheet's identity for the index, computed WITHOUT the transcription
 * (which is the expensive, metered step we are trying to skip). The drawing
 * bytes are identified by the durable storage path — never the signed URL,
 * which changes every time it is minted and would re-extract every sheet on
 * every press. Sheet number and name are in because they are the citation the
 * answer shows ("Sheet A-201"); renumbering a sheet must re-index it.
 */
export function planSheetFingerprint(sheet: {
  storagePath?: string; imageUri?: string; sheetNumber?: string; name?: string;
}): string {
  const bytesId = (sheet.storagePath ?? '').trim() || (sheet.imageUri ?? '').split('?')[0];
  return hashText(`${bytesId}\u0000${(sheet.sheetNumber ?? '').trim()}\u0000${(sheet.name ?? '').trim()}`);
}

// ── Scopes ──────────────────────────────────────────────────────────────────

/** Doc-id prefixes Project Memory owns (utils/projectMemory.ts extractMemoryDocs).
 *  A prune is limited to these, so syncing Project Memory can never delete a
 *  plan sheet or a Home Passport doc from the shared pool. */
export const MEMORY_DOC_PREFIXES = ['rfi-', 'dfr-', 'co-', 'sub-', 'punch-'] as const;
/** The `source` values Project Memory searches. Matches the docs it counts in
 *  "N records", so the count and the search cover the same set. */
export const MEMORY_RECORD_SOURCES = ['RFI', 'Daily Report', 'Change Order', 'Submittal', 'Punch Item'] as const;
export const PLAN_DOC_PREFIX = 'plan-sheet:';

/** Server cap per embed call (project-memory-embed MAX_DOCS). */
export const EMBED_BATCH = 250;

/**
 * Split into batches of at most `size`, never splitting one group across two
 * batches (a plan sheet's chunks must land together — the server deletes a
 * base's chunks that the batch did not write). A single group bigger than
 * `size` gets a batch of its own.
 */
export function batchGroups<T>(groups: readonly T[][], size = EMBED_BATCH): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    if (cur.length > 0 && cur.length + g.length > size) { out.push(cur); cur = []; }
    cur = cur.concat(g);
    if (cur.length >= size) { out.push(cur); cur = []; }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

// ── Retrieval floor ─────────────────────────────────────────────────────────

/**
 * Cosine similarity below which a vector "match" is not treated as grounding.
 *
 * WHY: match_project_memory has no floor — it always returns the top K, so
 * the semantic path always had "matches" and the keyword fallback never ran.
 * A question with no real answer in the record was answered from the eight
 * least-unrelated daily reports. 0.5 is a heuristic for the 768-dim unit
 * vectors _shared/embeddings.ts produces (on-topic construction text sits
 * well above it, unrelated text around or below); it is a named constant so
 * it can be tuned against real queries, not a measured threshold.
 */
export const MIN_MEMORY_SIMILARITY = 0.5;

export function confidentMatches<T extends { similarity?: number | null }>(matches: readonly T[]): T[] {
  return matches.filter(m => typeof m.similarity === 'number' && Number.isFinite(m.similarity) && m.similarity >= MIN_MEMORY_SIMILARITY);
}

// ── Plan indexing report ───────────────────────────────────────────────────

/** Why one sheet did not make it into the index this run. `code` is the edge
 *  function's own code when it gave one (monthly_cap_reached, hourly_limit,
 *  tier_required…); `reason` is the sentence the user reads. */
export interface PlanIndexSkip {
  sheetId: string;
  label: string;
  code: string;
  reason: string;
}

export interface PlanIndexResult {
  /** Current (non-superseded) sheets the run was asked to cover. */
  total: number;
  /** Already indexed from a previous run with the same drawing + number. */
  alreadyIndexed: number;
  /** Extracted and embedded this run. */
  newlyIndexed: number;
  skipped: PlanIndexSkip[];
  /** Superseded revisions left out on purpose (and removed from the index). */
  supersededExcluded: number;
}

/** Stop codes: once one sheet hits these, every later sheet would too, so the
 *  run stops calling (and stops spending the hourly bucket) and says so. */
export const PLAN_EXTRACT_STOP_CODES = new Set([
  'monthly_cap_reached', 'hourly_limit', 'rate_limited', 'rate_limiter_unavailable',
  'tier_required', 'upgrade_required', 'cap_reached',
]);

export type IndexTone = 'success' | 'warning' | 'danger' | 'muted';

export interface PlanIndexSummary {
  label: string;
  tone: IndexTone;
  /** One line per distinct skip reason, most common first: "19 sheets — Monthly plan-extract limit reached (100 on business)". */
  reasons: string[];
}

export function summarizePlanIndex(r: PlanIndexResult): PlanIndexSummary {
  const indexed = r.alreadyIndexed + r.newlyIndexed;
  const counts = new Map<string, number>();
  for (const s of r.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const reasons = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} sheet${n === 1 ? '' : 's'} — ${reason}`);

  if (r.total === 0) {
    return {
      label: r.supersededExcluded > 0 ? 'No current sheets to index (only superseded revisions)' : 'No sheets to index yet',
      tone: 'muted',
      reasons,
    };
  }
  const plural = (n: number) => `${n} sheet${n === 1 ? '' : 's'}`;
  // Success colour ONLY when every current sheet is searchable. 0 indexed is
  // never green — that was the lie: a web run that read nothing said
  // "Indexing complete" in success green, and the next question came back
  // "couldn't find that in your plans".
  if (indexed === r.total) {
    const fresh = r.newlyIndexed > 0 && r.alreadyIndexed > 0 ? ` (${r.newlyIndexed} new)` : '';
    return { label: `All ${plural(r.total)} indexed${fresh}`, tone: 'success', reasons };
  }
  if (indexed === 0) {
    return { label: `0 of ${plural(r.total)} indexed — answers can't use your plans yet`, tone: 'danger', reasons };
  }
  return {
    label: `Indexed ${indexed} of ${plural(r.total)} — ${r.total - indexed} not searchable`,
    tone: 'warning',
    reasons,
  };
}
