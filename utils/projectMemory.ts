// projectMemory.ts — ask your own project history, get an answer.
//
// Sibling to mageAgent ("Ask MAGE"): where that reasons over a business-wide
// snapshot (money/schedule/pipeline), this digs into ONE project's accumulated
// field knowledge — RFIs, daily reports, change-order rationales, submittals,
// punch items — and answers "why did we…", "how did we handle…", "what went
// wrong on…". The institutional memory that normally walks out the door when a
// PM moves on. Deep-research finding: no SMB competitor turns a contractor's own
// records into queryable memory.
//
// v1 retrieval is client-side TF-IDF over already-in-memory records (no
// embeddings infra exists yet — pgvector is a documented future upgrade). It's
// instant, offline, and free; the single AI call routes through the existing
// mageAI relay, which gives auth + graceful failure. Text daily caps are
// CLIENT-SIDE per the app's convention: every call site must checkAILimit
// (tier, 'smart', 'projectMemory') before calling and recordAIUsage after a
// successful non-cached answer. Pure extraction/retrieval functions; only
// answerFromMemory does I/O (the AI call).

import { mageAI } from '@/utils/mageAI';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { isExcludedMemoryRecord, type MemoryAskOptions } from '@/utils/projectMemoryCore';
import {
  batchGroups, confidentMatches, memoryDocHash, MEMORY_DOC_PREFIXES, MEMORY_RECORD_SOURCES,
} from '@/utils/plans/memoryIndexCore';
import type { RFI, DailyFieldReport, ChangeOrder, Submittal, PunchItem } from '@/types';

export { isExcludedMemoryRecord, type MemoryAskOptions };

export type MemorySource = 'RFI' | 'Daily Report' | 'Change Order' | 'Submittal' | 'Punch Item' | 'Home Passport';

export interface MemoryDoc {
  id: string;
  source: MemorySource;
  /** Short citation label, e.g. "RFI #12" or "Daily report 2026-03-04". */
  ref: string;
  /** ISO date for recency fallback + display. */
  date: string;
  /** Full searchable text for this record. */
  text: string;
}

export interface MemoryCollections {
  rfis: RFI[];
  dailyReports: DailyFieldReport[];
  changeOrders: ChangeOrder[];
  submittals: Submittal[];
  punchItems: PunchItem[];
}

export const PROJECT_MEMORY_SUGGESTIONS: string[] = [
  'Why did we change the kitchen scope?',
  'What issues came up during framing?',
  'How did we resolve the foundation RFI?',
  'What did the architect say about the windows?',
  'What punch items keep coming back?',
  'What caused the schedule delays?',
];

function clean(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Flatten a project's records into searchable memory docs. Each carries the
 * knowledge-bearing text fields for its type. Pure — pass project-scoped arrays.
 */
export function extractMemoryDocs(c: MemoryCollections): MemoryDoc[] {
  const docs: MemoryDoc[] = [];

  for (const r of c.rfis ?? []) {
    const parts = [`RFI #${r.number}: ${clean(r.subject)}`, clean(r.question) && `Question: ${clean(r.question)}`, clean(r.response) && `Answer: ${clean(r.response)}`];
    for (const h of r.handoffs ?? []) { const n = clean(h.note); if (n) parts.push(`Note: ${n}`); }
    docs.push({ id: `rfi-${r.id}`, source: 'RFI', ref: `RFI #${r.number}`, date: r.dateSubmitted || r.createdAt || '', text: parts.filter(Boolean).join('. ') });
  }

  for (const d of c.dailyReports ?? []) {
    const parts = [`Daily report ${clean(d.date)}`, clean(d.workPerformed) && `Work: ${clean(d.workPerformed)}`, clean(d.issuesAndDelays) && `Issues/delays: ${clean(d.issuesAndDelays)}`, (d.materialsDelivered?.length ? `Materials: ${d.materialsDelivered.map(clean).filter(Boolean).join(', ')}` : '')];
    const text = parts.filter(Boolean).join('. ');
    if (text.length > `Daily report ${clean(d.date)}`.length) {
      docs.push({ id: `dfr-${d.id}`, source: 'Daily Report', ref: `Daily report ${clean(d.date)}`, date: d.date || d.createdAt || '', text });
    }
  }

  for (const co of c.changeOrders ?? []) {
    const lines = (co.lineItems ?? []).map(li => clean((li as { description?: string }).description)).filter(Boolean);
    const parts = [`Change Order #${co.number}: ${clean(co.description)}`, clean(co.reason) && `Reason: ${clean(co.reason)}`, lines.length ? `Items: ${lines.join('; ')}` : '', `Amount $${Math.round(co.changeAmount || 0)}, status ${co.status}`];
    docs.push({ id: `co-${co.id}`, source: 'Change Order', ref: `CO #${co.number}`, date: co.date || co.createdAt || '', text: parts.filter(Boolean).join('. ') });
  }

  for (const s of c.submittals ?? []) {
    const comments = (s.reviewCycles ?? []).map(rc => clean(rc.comments)).filter(Boolean);
    const parts = [`Submittal #${s.number}: ${clean(s.title)}`, clean(s.specSection) && `Spec ${clean(s.specSection)}`, `status ${s.currentStatus}`, comments.length ? `Review: ${comments.join('; ')}` : ''];
    docs.push({ id: `sub-${s.id}`, source: 'Submittal', ref: `Submittal #${s.number}`, date: s.submittedDate || s.createdAt || '', text: parts.filter(Boolean).join('. ') });
  }

  for (const p of c.punchItems ?? []) {
    const parts = [`Punch item: ${clean(p.description)}`, clean(p.location) && `Location: ${clean(p.location)}`, `status ${p.status}`, clean(p.rejectionNote) && `Rework note: ${clean(p.rejectionNote)}`];
    docs.push({ id: `punch-${p.id}`, source: 'Punch Item', ref: `Punch: ${clean(p.description).slice(0, 40)}`, date: p.createdAt || '', text: parts.filter(Boolean).join('. ') });
  }

  return docs;
}

// ── TF-IDF retrieval (self-contained, no deps) ──────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'that', 'this', 'from', 'have',
  'has', 'had', 'did', 'does', 'what', 'when', 'where', 'why', 'how', 'who', 'our',
  'you', 'your', 'they', 'their', 'them', 'will', 'would', 'should', 'could', 'about',
  'into', 'out', 'any', 'all', 'can', 'get', 'got', 'not', 'but', 'its', 'his', 'her',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

export interface ScoredDoc extends MemoryDoc {
  score: number;
}

/**
 * Rank docs by TF-IDF relevance to the query. Returns the top-K with score > 0;
 * if nothing matches on keywords, falls back to the K most recent records so the
 * model still has grounding to work from.
 */
export function retrieveRelevant(query: string, docs: MemoryDoc[], topK = 8): ScoredDoc[] {
  if (docs.length === 0) return [];
  const N = docs.length;
  const tokenized = docs.map(d => tokenize(d.text));

  const df = new Map<string, number>();
  tokenized.forEach(toks => {
    for (const term of new Set(toks)) df.set(term, (df.get(term) ?? 0) + 1);
  });
  const idf = (term: string) => Math.log(N / (1 + (df.get(term) ?? 0))) + 1;

  const qTerms = [...new Set(tokenize(query))];
  const scored: ScoredDoc[] = docs.map((d, i) => {
    const toks = tokenized[i];
    if (toks.length === 0 || qTerms.length === 0) return { ...d, score: 0 };
    const counts = new Map<string, number>();
    for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of qTerms) {
      const tf = counts.get(term) ?? 0;
      if (tf > 0) score += (1 + Math.log(tf)) * idf(term);
    }
    return { ...d, score };
  });

  const hits = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  if (hits.length > 0) return hits.slice(0, topK);

  // No keyword overlap — fall back to most recent so the answer isn't blind.
  return [...scored]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, topK);
}

export interface MemoryAnswer {
  answer: string;
  usedRefs: string[];
  searched: number;
  matched: boolean;
  /** True when the answer used server-side semantic (pgvector) retrieval. */
  semantic?: boolean;
  /** Semantic answers only: how many of the `searched` records the vector
   *  index holds with their current text, when the last sync could tell. The
   *  screen shows "N of M indexed" instead of implying all M were searched. */
  indexed?: number;
  errorKind?: string;
  fromCache?: boolean;
}

/**
 * Answer a question from a project's memory. Retrieves the most relevant records
 * client-side, then asks the model to answer using only those — citing the
 * record refs. Never throws.
 */
export async function answerFromMemory(question: string, allDocs: MemoryDoc[], opts: MemoryAskOptions = {}): Promise<MemoryAnswer> {
  const q = question.trim();
  const docs = allDocs.filter(d => !isExcludedMemoryRecord(d, opts.excludeDocIds, opts.excludeRefs));
  const top = retrieveRelevant(q, docs, 8);
  const matched = top.some(d => d.score > 0);

  if (docs.length === 0) {
    return { answer: "This project has no records to remember yet — RFIs, daily reports, change orders, submittals and punch items will all become searchable here as you log them.", usedRefs: [], searched: 0, matched: false };
  }

  const context = top.map(d => `[${d.ref}${d.date ? ` · ${d.date.slice(0, 10)}` : ''}] ${d.text}`).join('\n\n');
  const prompt =
    "You are MAGE, the assistant inside a construction contractor's app. Answer the user's " +
    'question using ONLY the project records below. Be concise and concrete; cite the record ' +
    'reference (e.g. "RFI #12", "CO #4", the daily-report date) for each fact. Lead with the ' +
    "direct answer. If the records don't contain the answer, say so plainly rather than guessing.\n\n" +
    `PROJECT RECORDS:\n${context}\n\nQUESTION: ${q}`;

  try {
    const res = await mageAI({ prompt, tier: 'smart', maxTokens: 700, feature: opts.feature });
    const text = typeof res.data === 'string' && res.data.trim() ? res.data.trim() : (res.raw?.trim() || '');
    if (!res.success || !text) {
      return {
        answer: res.error ? `MAGE couldn't answer that: ${res.error}` : "MAGE couldn't answer that right now. Try again in a moment.",
        usedRefs: top.map(d => d.ref), searched: docs.length, matched, errorKind: res.errorKind, fromCache: res.fromCache,
      };
    }
    return { answer: text, usedRefs: top.map(d => d.ref), searched: docs.length, matched, errorKind: res.errorKind, fromCache: res.fromCache };
  } catch (e) {
    return { answer: `MAGE hit an error: ${String((e as Error).message ?? e)}`, usedRefs: [], searched: docs.length, matched };
  }
}

// ── v2: server-side semantic retrieval (pgvector), with TF-IDF fallback ──────
//
// When the project-memory-embed / -search edge functions + pgvector migration
// are deployed, retrieval becomes semantic (synonyms/paraphrase match). If they
// aren't deployed (or fail, or return nothing), everything falls back to the v1
// TF-IDF path above — so this is safe to ship before the backend is live.

const MEMORY_EMBED_URL = `${SUPABASE_URL}/functions/v1/project-memory-embed`;
const MEMORY_SEARCH_URL = `${SUPABASE_URL}/functions/v1/project-memory-search`;

const MEMORY_PROMPT_PREFIX =
  "You are MAGE, the assistant inside a construction contractor's app. Answer the user's " +
  'question using ONLY the project records below. Be concise and concrete; cite the record ' +
  'reference (e.g. "RFI #12", "CO #4", the daily-report date) for each fact. Lead with the ' +
  "direct answer. If the records don't contain the answer, say so plainly rather than guessing.\n\n";

interface MemoryMatch { doc_id: string; source: string; ref: string; content: string; similarity: number }

async function authedPost(url: string, body: unknown): Promise<unknown | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token;
    if (!jwt) return null;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export interface MemorySyncStatus {
  /** Records in the current doc list. */
  total: number;
  /** Of those, how many the index holds with their CURRENT text after this sync. */
  indexed: number;
  /** False when the sync could not reach the server or was refused. `reason` says why. */
  ok: boolean;
  reason?: string;
}

const lastSyncByProject = new Map<string, MemorySyncStatus>();
const inFlight = new Map<string, Promise<MemorySyncStatus>>();
const queued = new Map<string, { docs: MemoryDoc[]; opts: { scopePrefixes?: readonly string[]; prune?: boolean } }>();

/** The last sync result for a project this session, if any. */
export function memorySyncStatus(projectId: string): MemorySyncStatus | undefined {
  return lastSyncByProject.get(projectId);
}

/**
 * Keep the semantic index in step with the project's records. Incremental
 * (audit round 2, #23): ask the server which docs are missing or changed
 * (content hash), send ONLY those, in batches the server accepts, until every
 * record is covered — and, when `prune` is on, delete index rows for records
 * that no longer exist.
 *
 * Before: the first 250 docs in a fixed order (every RFI, then every daily
 * report newest-first, then COs, submittals, punch) were re-sent on every open.
 * Past 250 records, new submittals and punch items were never embedded, an
 * early submittal kept the text it had when first embedded — the "Revise and
 * resubmit", not the later "Approved as noted" — and a deleted RFI stayed
 * citable. That is how the RFI "suggest answer" could draft an old rejection.
 *
 * `prune` must only be set by a caller whose `docs` is the COMPLETE set for
 * `scopePrefixes` (Project Memory's five record types). The closeout binder's
 * Home Passport sync passes neither and is diff-only — it can never delete.
 *
 * Never throws. Concurrent calls for one project share the running sync.
 */
export async function syncMemoryEmbeddings(
  projectId: string,
  docs: MemoryDoc[],
  opts: { scopePrefixes?: readonly string[]; prune?: boolean } = {},
): Promise<MemorySyncStatus> {
  const total = docs.length;
  if (!projectId || total === 0) return { total, indexed: 0, ok: true };
  const running = inFlight.get(projectId);
  if (running) {
    // A newer doc list arrived mid-sync (records still hydrating, or an edit):
    // run once more with the LATEST list when this one ends. Only the newest
    // waiting call survives, so a burst of edits costs one extra manifest.
    queued.set(projectId, { docs, opts });
    return running.then(() => {
      const next = queued.get(projectId);
      if (!next || next.docs !== docs) return lastSyncByProject.get(projectId) ?? { total, indexed: 0, ok: false };
      queued.delete(projectId);
      return syncMemoryEmbeddings(projectId, next.docs, next.opts);
    });
  }

  const run = (async (): Promise<MemorySyncStatus> => {
    const hashes = new Map(docs.map(d => [d.id, memoryDocHash(d)]));
    const manifest = (await authedPost(MEMORY_EMBED_URL, {
      projectId,
      action: 'manifest',
      manifest: docs.map(d => ({ doc_id: d.id, hash: hashes.get(d.id) })),
      scopePrefixes: opts.scopePrefixes ?? [],
      prune: opts.prune === true,
    })) as { success?: boolean; stale?: string[] } | null;

    // Manifest unavailable (function not redeployed, offline, rate-limited):
    // fall back to sending everything in batches. Costlier, never less
    // complete — and `indexed` is then only what those batches confirm.
    const staleSet = manifest?.success && Array.isArray(manifest.stale) ? new Set(manifest.stale) : null;
    let indexed = staleSet ? docs.filter(d => !staleSet.has(d.id)).length : 0;
    const stale = staleSet ? docs.filter(d => staleSet.has(d.id)) : docs;

    let reason: string | undefined;
    for (const batch of batchGroups(stale.map(d => [d]))) {
      const res = (await authedPost(MEMORY_EMBED_URL, {
        projectId,
        docs: batch.map(d => ({ doc_id: d.id, source: d.source, ref: d.ref, content: d.text, content_hash: hashes.get(d.id) })),
      })) as { success?: boolean; embedded?: number } | null;
      if (!res?.success) {
        // Stop at the first refusal: the usual cause is the monthly memory cap
        // or the hourly bucket, and every later batch would hit it too.
        reason = 'The search index could not be updated just now.';
        break;
      }
      indexed += batch.length;
    }
    const status: MemorySyncStatus = { total, indexed, ok: !reason && (staleSet !== null || indexed === total), reason };
    lastSyncByProject.set(projectId, status);
    return status;
  })();
  inFlight.set(projectId, run);
  try {
    return await run;
  } finally {
    inFlight.delete(projectId);
  }
}

/** Project Memory's own scope, for the one caller whose doc list is complete. */
export const PROJECT_MEMORY_SYNC_SCOPE = { scopePrefixes: MEMORY_DOC_PREFIXES, prune: true } as const;

/**
 * Answer using semantic (pgvector) retrieval when available, falling back to the
 * v1 TF-IDF path on any failure/empty result. `docs` is still passed so the
 * fallback works and so the "searched N records" count stays meaningful.
 */
export async function answerFromMemorySemantic(
  question: string,
  projectId: string,
  docs: MemoryDoc[],
  opts: MemoryAskOptions = {},
): Promise<MemoryAnswer> {
  const q = question.trim();
  if (!projectId || docs.length === 0) return answerFromMemory(q, docs, opts);

  // `sources`: search only the record types this screen counts and cites —
  // plan-sheet transcriptions and Home Passport docs share the pool and used to
  // take slots in the top 8. The client filter below keeps an un-redeployed
  // function honest too.
  const res = (await authedPost(MEMORY_SEARCH_URL, { projectId, query: q, matchCount: 8, sources: MEMORY_RECORD_SOURCES })) as
    | { success?: boolean; matches?: MemoryMatch[] }
    | null;
  // confidentMatches: the RPC always returns K rows, so without a floor the
  // semantic path always "matched" and the keyword fallback never ran — an
  // unanswerable question was answered from the least-unrelated records.
  const rawMatches = res && res.success && Array.isArray(res.matches)
    ? confidentMatches(res.matches.filter(m => (MEMORY_RECORD_SOURCES as readonly string[]).includes(m.source)))
    : null;
  // The pgvector index holds EVERY record ever synced — including the record
  // being edited right now (an RFI's own question is its own nearest neighbor).
  // Filter exclusions out BEFORE building context/citations, then re-check
  // emptiness so a fully-excluded result falls through to TF-IDF.
  const matches = rawMatches
    ? rawMatches.filter(m => !isExcludedMemoryRecord(m, opts.excludeDocIds, opts.excludeRefs))
    : null;

  if (matches && matches.length > 0) {
    const context = matches.map(m => `[${m.ref}] ${m.content}`).join('\n\n');
    const prompt = MEMORY_PROMPT_PREFIX + `PROJECT RECORDS:\n${context}\n\nQUESTION: ${q}`;
    try {
      const ai = await mageAI({ prompt, tier: 'smart', maxTokens: 700, feature: opts.feature });
      const text = typeof ai.data === 'string' && ai.data.trim() ? ai.data.trim() : (ai.raw?.trim() || '');
      if (ai.success && text) {
        return {
          answer: text,
          usedRefs: matches.map(m => m.ref),
          searched: docs.length,
          matched: true,
          semantic: true,
          indexed: memorySyncStatus(projectId)?.indexed,
          errorKind: ai.errorKind,
          fromCache: ai.fromCache,
        };
      }
    } catch {
      // fall through to TF-IDF
    }
  }

  // Not deployed / no match / AI hiccup → v1 keyword path.
  return answerFromMemory(q, docs, opts);
}

/**
 * Semantic (pgvector) retrieval that returns DOCS — the retrieval primitive for
 * callers like One Mind that fuse memory facts with OTHER engines (unlike
 * answerFromMemorySemantic, which composes a standalone answer). Races the
 * edge-function search against a short timeout and falls back to TF-IDF
 * retrieveRelevant on ANY failure — no session, tier rejection, empty result,
 * error, or timeout — so it can only enrich the memory block or leave it
 * unchanged, never make it worse or slow it unbounded. `docs` is the corpus for
 * the fallback and for resolving each match's original date/source.
 */
export async function retrieveRelevantSemantic(
  projectId: string,
  query: string,
  docs: MemoryDoc[],
  topK = 8,
  timeoutMs = 2000,
): Promise<MemoryDoc[]> {
  const q = query.trim();
  const fallback = () => retrieveRelevant(q, docs, topK);
  if (!projectId || docs.length === 0) return fallback();
  try {
    const res = (await Promise.race([
      authedPost(MEMORY_SEARCH_URL, { projectId, query: q, matchCount: topK, sources: MEMORY_RECORD_SOURCES }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ])) as { success?: boolean; matches?: MemoryMatch[] } | null;
    // Same source scope + similarity floor as answerFromMemorySemantic, so an
    // all-weak result falls back to keywords instead of feeding One Mind noise.
    const matches = res && res.success && Array.isArray(res.matches)
      ? confidentMatches(res.matches.filter(m => (MEMORY_RECORD_SOURCES as readonly string[]).includes(m.source)))
      : null;
    if (matches && matches.length > 0) {
      const byId = new Map(docs.map(d => [d.id, d]));
      return matches.map(m => {
        const orig = byId.get(m.doc_id);
        return {
          id: m.doc_id,
          source: orig?.source ?? (m.source as MemorySource),
          ref: m.ref,
          date: orig?.date ?? '',
          text: m.content,
        } as MemoryDoc;
      });
    }
  } catch {
    // fall through to the keyword path
  }
  return fallback();
}
