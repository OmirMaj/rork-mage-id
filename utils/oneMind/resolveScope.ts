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
//      a. ALL significant tokens of its name AND at least one matched token
//         is not a generic construction word (full-name match — without the
//         non-generic requirement, a project named "Garage" or "Kitchen
//         Remodel" hijacks every business-wide question that mentions those
//         ordinary words: "should I take on more garage jobs?" is a
//         portfolio question, not a question about the job named Garage), or
//      b. a token that is unique to that project across the portfolio and
//         not a generic construction word (distinctive-token match).
//      Consequence: an ALL-generic project name can never be resolved by
//      name — those questions resolve DOWN to business scope, which still
//      carries every project's records (rule 5's philosophy).
//   3. Longest match (most matched characters) wins.
//   4. ANY candidate whose matched tokens are DISJOINT from the top
//      candidate's = a cross-project question ("compare henderson and
//      lakewood") → business scope. Checked against every candidate, not
//      just the runner-up — with three projects named, the two overlapping
//      Hendersons must not mask the disjoint Lakewood.
//   5. No candidate → business scope. Ambiguity resolves DOWN to business —
//      a business-wide answer that names both Hendersons beats guessing one.
//
// Pure. No React. No network. Bun-validated by scripts/validate-onemind-scope.ts.

export interface ScopeProjectRef {
  id: string;
  name: string;
}

export type OneMindScope =
  | { scope: 'business'; matchedProjectIds?: string[] }
  | { scope: 'project'; projectId: string };

/** Generic construction words that must never resolve a project on their own.
 *  They still count toward full-name matches, but a full-name match needs at
 *  least one NON-generic token ("Henderson Remodel" is reachable by its whole
 *  name; a project named just "Garage" is not — see rule 2a). */
const GENERIC_TOKENS = new Set([
  // Rooms / spaces
  'kitchen', 'bath', 'bathroom', 'basement', 'garage', 'attic', 'closet',
  'porch', 'patio', 'balcony', 'sunroom', 'office',
  // Structures / site
  'deck', 'roof', 'pool', 'fence', 'fencing', 'shed', 'pergola', 'gazebo',
  'carport', 'driveway', 'sidewalk', 'yard', 'barn',
  // Trades / systems
  'paint', 'painting', 'siding', 'hvac', 'plumbing', 'electrical', 'roofing',
  'drywall', 'concrete', 'framing', 'flooring', 'tile', 'tiling',
  'insulation', 'landscaping', 'landscape', 'gutter', 'gutters',
  'window', 'windows', 'door', 'doors', 'cabinet', 'cabinets',
  'countertop', 'countertops', 'fireplace', 'chimney', 'solar', 'septic',
  'masonry', 'stucco', 'paving',
  // Job words
  'remodel', 'remodels', 'remodeling', 'renovation', 'reno', 'addition',
  'adu', 'repair', 'repairs', 'install', 'installation', 'upgrade',
  'upgrades', 'conversion', 'restoration', 'rebuild', 'extension',
  'demo', 'demolition',
  // Property words
  'house', 'home', 'homes', 'residence', 'property', 'unit', 'apt', 'suite',
  'condo', 'apartment', 'duplex', 'townhouse', 'cottage', 'cabin', 'ranch',
  // Filler
  'project', 'job', 'jobs', 'build', 'building', 'construction', 'custom',
  'street', 'ave', 'avenue', 'road', 'drive', 'lane', 'court', 'place',
  'blvd', 'boulevard', 'way', 'circle', 'terrace',
  'main', 'new', 'the', 'and', 'for', 'with',
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

    // Rule 2a: a full-name match only counts when at least one matched token
    // is non-generic. An all-generic name ("Garage", "Kitchen Remodel") would
    // otherwise capture every business question that uses those trade words.
    const hasNonGeneric = [...matched].some(t => !GENERIC_TOKENS.has(t));
    const fullMatch = matched.size === sig.length && hasNonGeneric;
    const distinctive = [...matched].some(
      t => (tokenCount.get(t) ?? 0) === 1 && !GENERIC_TOKENS.has(t),
    );
    if (!fullMatch && !distinctive) return;

    const score = [...matched].reduce((s, t) => s + t.length, 0);
    candidates.push({ projectId: p.id, matched, score });
  });

  if (candidates.length === 0) return { scope: 'business' };

  candidates.sort((a, b) => b.score - a.score);
  // Rule 4 across EVERY candidate, not just the runner-up: if any other
  // candidate matched on tokens fully disjoint from the top's, two genuinely
  // different projects were named → cross-project → business. (Top-two-only
  // checking let "compare henderson remodel and henderson addition and
  // lakewood" silently resolve to one Henderson — the two overlapping
  // Hendersons outranked and masked the disjoint Lakewood.)
  const top = candidates[0];
  const disjointIds: string[] = [];
  for (let i = 1; i < candidates.length; i++) {
    const overlaps = [...candidates[i].matched].some(t => top.matched.has(t));
    if (!overlaps) disjointIds.push(candidates[i].projectId);
  }
  if (disjointIds.length > 0) {
    // Cross-project question — include ALL matched candidate IDs so the
    // business assembler knows which projects were compared.
    const matchedProjectIds = [top.projectId, ...disjointIds];
    return { scope: 'business', matchedProjectIds };
  }
  return { scope: 'project', projectId: top.projectId };
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

// ─── Anchored conversations (audit #36) ─────────────────────────────────────
//
// Opened from a project's own screen, "Is this project over budget?" names no
// project — so resolveScope correctly answers "business", and the GC standing
// on Henderson's page got a whole-business reply with no margin in it, and
// "Which invoices here are still unpaid?" listed every job's invoices. The
// Brain FAB now forwards the job the user was looking at as the conversation's
// ANCHOR (app/ask.tsx), and this decides when the anchor applies:
//
//   - a question that names a project (or compares two) keeps what the name
//     resolved to — an explicit name always beats the anchor;
//   - a question that says it's about the whole business ("across all jobs",
//     "every job", "my business", "portfolio") stays business-wide;
//   - anything else inside an anchored conversation is about the anchor.
//
// Pure, like resolveScope; the caller passes the anchor only when it is one of
// the user's projects (an unknown id is ignored here too).

/** Words that say "all of my jobs", so an anchored conversation can still
 *  ask a business-wide question. Matched on whole words. Bare "overall",
 *  "company" and "business" are NOT here: "Is this job over budget overall?"
 *  and "Who is the company on the electrical?" are about the anchored job,
 *  and dropping the anchor for them is the #36 bug again. */
const BUSINESS_WIDE = /\b(all (?:(?:of )?my |the |our )?(?:jobs|projects)|every (?:job|project)|across|(?:my|our) (?:whole |entire )?(?:business|company)|the (?:whole |entire )?business|company-wide|business-wide|portfolio|each (?:job|project)|all jobs|which (?:job|project)|what (?:jobs|projects))\b/i;

export function isBusinessWideQuestion(question: string): boolean {
  return BUSINESS_WIDE.test(question);
}

export function applyAnchorScope(
  resolved: OneMindScope,
  question: string,
  anchorProjectId: string | null | undefined,
  projects: ScopeProjectRef[],
): OneMindScope {
  if (!anchorProjectId || !projects.some(p => p.id === anchorProjectId)) return resolved;
  // A named project (or a cross-project compare) wins over the anchor.
  if (resolved.scope === 'project') return resolved;
  if (resolved.matchedProjectIds && resolved.matchedProjectIds.length > 0) return resolved;
  if (isBusinessWideQuestion(question)) return resolved;
  return { scope: 'project', projectId: anchorProjectId };
}
