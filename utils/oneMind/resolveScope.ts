// utils/oneMind/resolveScope.ts — One Mind's question router.
//
// Decides whether a question is about ONE project or the whole business —
// deterministically, with NO AI call (the copilot's splitIntents burns a
// model call per routing decision; a scope decision doesn't need one).
//
// Mirrors the entityResolver narrowness principle (utils/entityResolver.ts):
// resolve only on real evidence, never on vibes. Rules:
//   1. Normalize question + project names (lowercase, alphanumeric tokens).
//   2. A project is a CANDIDATE when the question contains either
//      a. ALL significant tokens of its name (full-name match), or
//      b. a token that is unique to that project across the portfolio and
//         not a generic construction word (distinctive-token match).
//   3. Longest match (most matched characters) wins.
//   4. Two candidates with DISJOINT matched tokens = a cross-project
//      question ("compare henderson and lakewood") → business scope.
//   5. No candidate → business scope. Ambiguity resolves DOWN to business —
//      a business-wide answer that names both Hendersons beats guessing one.
//
// Pure. No React. No network. Bun-validated by scripts/validate-onemind-scope.ts.

export interface ScopeProjectRef {
  id: string;
  name: string;
}

export type OneMindScope =
  | { scope: 'business' }
  | { scope: 'project'; projectId: string };

/** Generic construction words that must never resolve a project on their own.
 *  They still count toward full-name matches ("Kitchen Remodel" is reachable
 *  by saying its whole name). */
const GENERIC_TOKENS = new Set([
  'kitchen', 'bath', 'bathroom', 'basement', 'garage', 'deck', 'roof',
  'remodel', 'remodels', 'renovation', 'reno', 'addition', 'adu',
  'house', 'home', 'homes', 'residence', 'property', 'unit', 'apt', 'suite',
  'project', 'job', 'jobs', 'build', 'building', 'construction', 'custom',
  'street', 'ave', 'avenue', 'road', 'drive', 'lane', 'court', 'place', 'blvd',
  'main', 'new', 'the', 'and',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length >= 3);
}

/**
 * Resolve which scope a question addresses. See file header for the rules.
 */
export function resolveScope(question: string, projects: ScopeProjectRef[]): OneMindScope {
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0 || projects.length === 0) return { scope: 'business' };

  // How many projects carry each significant token — a token unique to one
  // project (count 1) can identify it on its own.
  const tokenCount = new Map<string, number>();
  const projectTokens = projects.map(p => tokenize(p.name));
  for (const toks of projectTokens) {
    for (const t of new Set(toks)) tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
  }

  interface Candidate { projectId: string; matched: Set<string>; score: number }
  const candidates: Candidate[] = [];

  projects.forEach((p, i) => {
    const sig = [...new Set(projectTokens[i])];
    if (sig.length === 0) return;
    const matched = new Set(sig.filter(t => qTokens.has(t)));
    if (matched.size === 0) return;

    const fullMatch = matched.size === sig.length;
    const distinctive = [...matched].some(
      t => (tokenCount.get(t) ?? 0) === 1 && !GENERIC_TOKENS.has(t),
    );
    if (!fullMatch && !distinctive) return;

    const score = [...matched].reduce((s, t) => s + t.length, 0);
    candidates.push({ projectId: p.id, matched, score });
  });

  if (candidates.length === 0) return { scope: 'business' };

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length >= 2) {
    const [a, b] = candidates;
    const overlaps = [...a.matched].some(t => b.matched.has(t));
    // Two genuinely different projects named → cross-project → business.
    if (!overlaps) return { scope: 'business' };
  }
  return { scope: 'project', projectId: candidates[0].projectId };
}

/**
 * Is an utterance a QUESTION (knowing) rather than a request to DO something?
 * Used by the copilot hub's no-match branch to hand question-shaped utterances
 * to Ask MAGE instead of dead-ending. Regex is the plan-specified word list.
 */
export function isQuestionShaped(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\?\s*$/.test(t)) return true;
  return /^(who|what|when|where|why|how|which|is|are|do|does|can|should|will)\b/i.test(t);
}
