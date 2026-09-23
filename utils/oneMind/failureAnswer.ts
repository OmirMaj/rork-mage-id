// utils/oneMind/failureAnswer.ts — what Ask MAGE says when the model didn't answer.
//
// Split out of answer.ts (which imports the network relay) so the rule is pure
// and Bun-testable: scripts/validate-w5-ai-limits-answer.ts drives it directly.
//
// THE RULE (audit #119). There are two very different reasons the model gave
// no answer, and they need opposite replies:
//
//   1. The GC is BLOCKED — out of AI for the month, over the hourly limit, or
//      signed out. Nothing about "reaching" the AI failed; the relay said no,
//      and told us why. The reply is that reason, verbatim (the relay's
//      sentence already names the cap and the reset), and NO facts: the old
//      path printed "I couldn't reach the AI right now" plus the top lines of
//      WATCH and CASH, whatever he had asked, and never told him he was out of
//      AI or needed to sign in. The screen turns errorKind / errorCode into
//      the one action that fixes it (See plans / Sign in).
//
//   2. The AI was UNREACHABLE — offline, timed out, a 5xx, an empty model
//      reply. Here the verbatim-facts fallback still earns its place (the data
//      can speak without the model), but it opens by saying plainly that it is
//      NOT an answer to his question, so two unrelated fact lines can't be read
//      as one.

import type { FactBlock } from './factBlocks';

export interface OneMindFailureInput {
  error?: string;
  errorKind?: string;
  errorCode?: string;
}

export interface OneMindFailureReply {
  answer: string;
  /** Blocks quoted verbatim (unreachable case only) — rendered as chips. */
  used: FactBlock[];
  errorKind: string;
  errorCode?: string;
  /** True when the user was blocked (cap / session), not failed on. */
  blocked: boolean;
}

/** errorKinds that mean "the relay refused", not "the relay was unreachable".
 *  mageAI maps EVERY 429 to 'monthly_cap' (the hourly limit included — the
 *  errorCode tells them apart), and a missing or expired session to
 *  'unauthenticated'. */
export const BLOCKED_ERROR_KINDS: ReadonlySet<string> = new Set(['monthly_cap', 'unauthenticated']);

export const FALLBACK_OPENING =
  "MAGE couldn't reach the AI, so this doesn't answer your question. Here's the top of your data:";

/** Verbatim-facts fallback: the first two blocks with facts (assembly order =
 *  priority), skipping the RECORDS dump. */
export function fallbackFacts(blocks: FactBlock[]): { text: string; used: FactBlock[] } {
  const preferred = blocks.filter(b => b.ref !== 'RECORDS' && b.facts.length > 0).slice(0, 2);
  const used = preferred.length > 0 ? preferred : blocks.filter(b => b.facts.length > 0).slice(0, 1);
  if (used.length === 0) return { text: '', used: [] };
  const lines = used.flatMap(b => b.facts.slice(0, 3).map(f => `• ${f}`));
  return { text: `${FALLBACK_OPENING}\n\n${lines.join('\n')}`, used };
}

export function oneMindFailureReply(res: OneMindFailureInput, blocks: FactBlock[]): OneMindFailureReply {
  const errorKind = res.errorKind ?? 'model';
  if (BLOCKED_ERROR_KINDS.has(errorKind)) {
    const fallback = errorKind === 'unauthenticated'
      ? 'Sign in to ask MAGE about your jobs.'
      : res.errorCode === 'hourly_limit'
        ? "You've hit the hourly AI limit. Try again in an hour."
        : "You've used this month's AI allowance.";
    return {
      answer: res.error?.trim() || fallback,
      used: [],
      errorKind,
      errorCode: res.errorCode,
      blocked: true,
    };
  }
  const fb = fallbackFacts(blocks);
  return {
    answer: fb.text || (res.error
      ? `MAGE couldn't answer that: ${res.error}`
      : "MAGE couldn't answer that right now. Try again in a moment."),
    used: fb.used,
    errorKind,
    errorCode: res.errorCode,
    blocked: false,
  };
}
