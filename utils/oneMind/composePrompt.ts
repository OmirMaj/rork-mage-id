// utils/oneMind/composePrompt.ts — the fused grounded prompt.
//
// Discipline inherited from the two proven prompt styles in this codebase:
//   - projectMemory's "ONLY the records below + cite refs" grounding
//   - narrateVerdict's "use ONLY the numbers below, never invent a figure"
// HYBRID VOICE: dense stats stay third-person; "I" only for judgment lines.
// The model must cite the blocks it used ([MARGIN], [WATCH]) so the UI can
// render tappable drill-in chips, and must prefer "that's not in your data"
// over invention.
//
// Pure. No React. No network. Bun-validated by validate-onemind-compose.ts.

import type { FactBlock } from './factBlocks';

/** Total serialized-blocks budget (~3k tokens) — mageAgent's cap style. */
export const ONE_MIND_TOTAL_CAP = 12_000;

/** Per-block char caps. RECORDS is the dense whole-business dump; MEMORY
 *  carries verbatim record text; engine blocks are already terse. */
export const BLOCK_CHAR_CAPS: Record<string, number> = {
  RECORDS: 4_500,
  MEMORY: 2_200,
};
const DEFAULT_BLOCK_CAP = 1_400;

const MAX_TURNS = 6;

function capBlockFacts(block: FactBlock, remaining: number): string[] {
  const cap = Math.min(BLOCK_CHAR_CAPS[block.ref] ?? DEFAULT_BLOCK_CAP, remaining);
  const out: string[] = [];
  let used = 0;
  for (const fact of block.facts) {
    if (used + fact.length > cap) {
      if (out.length === 0) {
        // A single oversized fact: hard-truncate rather than dropping the block.
        out.push(fact.slice(0, Math.max(0, cap - 1)) + '…');
        used = cap;
      }
      break;
    }
    out.push(fact);
    used += fact.length + 1;
  }
  return out;
}

export interface ComposeArgs {
  question: string;
  /** Prior conversation turns, oldest first. Capped to the last 6. */
  turns: { role: 'user' | 'assistant'; text: string }[];
  blocks: FactBlock[];
  /** Optional context note, e.g. `Project scope: Henderson Remodel`. */
  scopeLabel?: string;
}

/**
 * Build the One Mind prompt: discipline header, serialized fact blocks with
 * citation refs, recent turns, question LAST (recency bias works for us).
 */
export function composeOneMindPrompt({ question, turns, blocks, scopeLabel }: ComposeArgs): string {
  const parts: string[] = [];

  parts.push(
    'You are MAGE, the single mind inside a construction contractor\'s app. ' +
    'Answer the user\'s question using ONLY the fact blocks below — they were computed ' +
    'from the contractor\'s own logged data by the app\'s engines. Never invent a number, ' +
    'date, name or dollar amount that is not in a block. ' +
    'Cite the block refs you used in square brackets, e.g. [MARGIN] or [WATCH], at the end ' +
    'of the sentence each supports — the app turns citations into tappable links. ' +
    'Lead with the direct answer, then the most important supporting facts. ' +
    'Keep dense figures third-person; use "I" only when giving a judgment call. ' +
    'If the blocks don\'t contain what\'s needed, say plainly that\'s not in your data yet ' +
    '(and name what to log to get it) rather than guessing.',
  );

  if (scopeLabel) parts.push(`SCOPE: ${scopeLabel}`);

  // ── Serialized blocks (capped per block + in total) ────────────────────
  const blockParts: string[] = [];
  let total = 0;
  for (const block of blocks) {
    if (total >= ONE_MIND_TOTAL_CAP) break;
    const facts = capBlockFacts(block, ONE_MIND_TOTAL_CAP - total);
    if (facts.length === 0) continue;
    const section = `### [${block.ref}] ${block.domain}\n${facts.map(f => `- ${f}`).join('\n')}`;
    blockParts.push(section);
    total += section.length;
  }
  parts.push(`FACT BLOCKS:\n\n${blockParts.join('\n\n')}`);

  // ── Recent conversation (multi-turn continuity) ────────────────────────
  const recent = turns.slice(-MAX_TURNS);
  if (recent.length > 0) {
    parts.push(
      'CONVERSATION SO FAR:\n' +
      recent.map(t => `${t.role === 'user' ? 'User' : 'MAGE'}: ${t.text}`).join('\n'),
    );
  }

  parts.push(`QUESTION: ${question}`);
  return parts.join('\n\n');
}

/** Any bracket group that could be a citation. Kept short (≤80 chars) so a
 *  stray unclosed bracket can't swallow half the answer. */
const CITATION_GROUP_RE = /\[([^\[\]\n]{1,80})\]/g;

/**
 * Resolve one bracket group's content to known block refs, or null when the
 * group is NOT a citation (any non-ref token → leave it alone: `[RFI-3]`
 * memory-record echoes and prose brackets must survive both parse and strip).
 * Tolerates the decorated form `[WATCH·Henderson]` (ref before the `·`/`:`/
 * `|`), lowercase refs (`[margin]`), and multi-ref lists (`[MARGIN, WATCH]`,
 * `[MARGIN and CASH]`).
 */
function groupCitationRefs(content: string, known: Set<string>): string[] | null {
  const head = content.split(/[·:|]/)[0];
  const tokens = head.split(/[,&+]|\band\b|\s+/i).map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const refs: string[] = [];
  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (!known.has(upper)) return null;
    refs.push(upper);
  }
  return refs;
}

/**
 * Pull the block refs the model cited, in first-appearance order, deduped.
 * Unknown refs are dropped — only real blocks become drill-in chips.
 */
export function parseCitations(answer: string, blocks: FactBlock[]): string[] {
  const known = new Set(blocks.map(b => b.ref));
  const seen: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CITATION_GROUP_RE.source, 'g');
  while ((m = re.exec(answer)) !== null) {
    const refs = groupCitationRefs(m[1], known);
    if (!refs) continue;
    for (const ref of refs) {
      if (!seen.includes(ref)) seen.push(ref);
    }
  }
  return seen;
}

/**
 * Remove recognized citation markers from the display text — the chips carry
 * the refs, so raw `[MARGIN]` markers in the bubble are noise. Groups that
 * are NOT recognized citations (memory-record echoes like `[RFI-3 · …]`,
 * prose brackets) are left untouched. Newlines are preserved; spacing around
 * removed markers is tidied.
 */
export function stripCitations(answer: string, blocks: FactBlock[]): string {
  const known = new Set(blocks.map(b => b.ref));
  const re = new RegExp(`[ \\t]*${CITATION_GROUP_RE.source}`, 'g');
  return answer
    .replace(re, (full, content: string) => (groupCitationRefs(content, known) ? '' : full))
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
