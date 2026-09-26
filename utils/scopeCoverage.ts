// utils/scopeCoverage.ts — the shared "is this already in contract scope?"
// comparator. Scope Code Gaps (L1) and the RFI scope check (L2) both ask it.
//
// It indexes what the job already carries — estimate lines, the lines and
// descriptions of CAPTURED change orders (utils/profitLeak/scopeSummary
// CAPTURED_STATUSES: rejected and void never count), the contract scope text
// and the scope notes — and answers a phrase query (word-boundary match) or a
// free-text description (token overlap).
//
// CONSERVATIVE ON PURPOSE: a false "covered" hides billable scope, so callers
// must SHOW covered items with their explain, never drop them.
//
// Pure — no React, no storage, no network.
import type { ChangeOrder } from '@/types';
import { CAPTURED_STATUSES } from '@/utils/profitLeak/scopeSummary';

export interface ScopeLine { name: string; category?: string; quantity?: number; unit?: string }
export type ScopeSourceKind = 'estimate_line' | 'co_line' | 'co_description' | 'contract_text' | 'scope_note';
export interface ScopeSource { kind: ScopeSourceKind; label: string; text: string; norm: string; tokens: string[] }
export interface ScopeIndex {
  sources: ScopeSource[];
  counts: { estimateLines: number; changeOrders: number; contractText: boolean; scopeNotes: number };
}
export interface ScopeIndexInput {
  estimateLines?: readonly ScopeLine[];
  changeOrders?: readonly ChangeOrder[];
  projectId?: string;
  contractScopeText?: string | null;
  scopeNotes?: readonly (string | null | undefined)[];
}
export type CoverageQuery = { phrases: readonly string[] } | { description: string };
export interface CoverageMatch { source: ScopeSource; matched: string }
export interface CoverageResult { covered: boolean; basis: 'phrase' | 'tokens' | 'none'; matches: CoverageMatch[]; explain: string }

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'per', 'all', 'new', 'existing', 'install', 'installed',
  'provide', 'furnish', 'add', 'added', 'extra', 'additional', 'work', 'item', 'items', 'each',
  'lot', 'allowance', 'labor', 'material', 'materials', 'ea', 'lf', 'sf', 'ls',
]);

/** lowercase; '&' → ' and '; everything but [a-z0-9/ ] → space; collapse; trim. */
export function normalizeScopeText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalized words (split on space and '/') of length ≥ 3, minus stopwords, trailing 's' dropped on words > 4. Unique, in order. */
export function scopeTokens(s: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeScopeText(s).split(/[ /]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    const w = raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * Word-boundary containment on normalized text. '/' counts as a boundary too,
 * so 'smoke' is found in 'smoke/co combo detectors' and '5/8' or
 * 'washer/dryer' still match as a whole.
 */
export function phraseInNorm(norm: string, phrase: string): boolean {
  const p = normalizeScopeText(phrase);
  if (!p || !norm) return false;
  let from = 0;
  for (;;) {
    const at = norm.indexOf(p, from);
    if (at < 0) return false;
    const before = at === 0 ? ' ' : norm[at - 1];
    const afterIdx = at + p.length;
    const after = afterIdx >= norm.length ? ' ' : norm[afterIdx];
    if ((before === ' ' || before === '/') && (after === ' ' || after === '/')) return true;
    from = at + 1;
  }
}

function source(kind: ScopeSourceKind, label: string, text: string): ScopeSource {
  return { kind, label, text, norm: normalizeScopeText(text), tokens: scopeTokens(text) };
}

export function buildScopeIndex(input: ScopeIndexInput): ScopeIndex {
  const sources: ScopeSource[] = [];
  const lines = input.estimateLines ?? [];
  lines.forEach((l, i) => {
    const name = (l?.name ?? '').trim();
    const text = `${name} ${l?.category ?? ''}`.trim();
    if (!text) return;
    sources.push(source('estimate_line', `line ${i + 1} "${name}"`, text));
  });

  const captured = (input.changeOrders ?? []).filter(c =>
    !!c && CAPTURED_STATUSES.has(c.status) && (input.projectId == null || c.projectId === input.projectId));
  for (const co of captured) {
    for (const li of co.lineItems ?? []) {
      const lineName = (li?.name ?? '').trim();
      const text = `${lineName} ${li?.description ?? ''}`.trim();
      if (!text) continue;
      sources.push(source('co_line', `CO #${co.number} "${lineName}"`, text));
    }
    const desc = (co.description ?? '').trim();
    if (desc) sources.push(source('co_description', `CO #${co.number}`, desc));
  }

  const contract = (input.contractScopeText ?? '').trim();
  if (contract) sources.push(source('contract_text', 'the contract scope text', contract));

  let scopeNotes = 0;
  for (const n of input.scopeNotes ?? []) {
    const t = (n ?? '').trim();
    if (!t) continue;
    scopeNotes += 1;
    sources.push(source('scope_note', 'your scope notes', t));
  }

  return {
    sources,
    counts: {
      estimateLines: sources.filter(s => s.kind === 'estimate_line').length,
      changeOrders: captured.length,
      contractText: !!contract,
      scopeNotes,
    },
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function notFoundExplain(idx: ScopeIndex): string {
  const { estimateLines: a, changeOrders: b, contractText } = idx.counts;
  return `Not found in ${plural(a, 'estimate line')}${b ? ` and ${plural(b, 'change order')}` : ''}${contractText ? ' or the contract scope text' : ''}`;
}

export const EMPTY_SCOPE_EXPLAIN = 'No estimate lines, change orders or contract scope on file to compare with';

export function isInContractScope(q: CoverageQuery, idx: ScopeIndex): CoverageResult {
  if (idx.sources.length === 0) {
    return { covered: false, basis: 'none', matches: [], explain: EMPTY_SCOPE_EXPLAIN };
  }
  const matches: CoverageMatch[] = [];
  let basis: CoverageResult['basis'] = 'none';

  if ('phrases' in q) {
    for (const s of idx.sources) {
      const hit = q.phrases.find(p => phraseInNorm(s.norm, p));
      if (hit) matches.push({ source: s, matched: hit });
    }
    if (matches.length) basis = 'phrase';
  } else {
    const qt = scopeTokens(q.description);
    if (qt.length > 0) {
      for (const s of idx.sources) {
        const shared = qt.filter(t => s.tokens.includes(t));
        const byOverlap = shared.length >= 2 && shared.length / qt.length >= 0.6;
        const byShort = qt.length <= 2 && shared.length === qt.length;
        if (byOverlap || byShort) matches.push({ source: s, matched: shared.join(' ') });
      }
    }
    if (matches.length) basis = 'tokens';
  }

  if (matches.length) {
    return { covered: true, basis, matches, explain: `Matches ${matches[0].source.label}` };
  }
  return { covered: false, basis: 'none', matches: [], explain: notFoundExplain(idx) };
}
