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
// mageAI relay, so we inherit auth + monthly caps + graceful failure. Pure
// extraction/retrieval functions; only answerFromMemory does I/O (the AI call).

import { mageAI } from '@/utils/mageAI';
import type { RFI, DailyFieldReport, ChangeOrder, Submittal, PunchItem } from '@/types';

export type MemorySource = 'RFI' | 'Daily Report' | 'Change Order' | 'Submittal' | 'Punch Item';

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
  errorKind?: string;
  fromCache?: boolean;
}

/**
 * Answer a question from a project's memory. Retrieves the most relevant records
 * client-side, then asks the model to answer using only those — citing the
 * record refs. Never throws.
 */
export async function answerFromMemory(question: string, docs: MemoryDoc[]): Promise<MemoryAnswer> {
  const q = question.trim();
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
    const res = await mageAI({ prompt, tier: 'smart', maxTokens: 700 });
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
