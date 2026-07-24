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

/**
 * Best-effort: push a project's records to the embeddings index so semantic
 * search has fresh vectors. Idempotent server-side (upsert). Fire-and-forget;
 * failures are silent (the screen still works on TF-IDF).
 */
export async function syncMemoryEmbeddings(projectId: string, docs: MemoryDoc[]): Promise<void> {
  if (!projectId || docs.length === 0) return;
  const payload = docs.slice(0, 250).map(d => ({ doc_id: d.id, source: d.source, ref: d.ref, content: d.text }));
  await authedPost(MEMORY_EMBED_URL, { projectId, docs: payload });
}

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

  const res = (await authedPost(MEMORY_SEARCH_URL, { projectId, query: q, matchCount: 8 })) as
    | { success?: boolean; matches?: MemoryMatch[] }
    | null;
  const rawMatches = res && res.success && Array.isArray(res.matches) ? res.matches : null;
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
