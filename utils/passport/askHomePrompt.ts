// askHomePrompt — the grounding contract for Ask Your Home answers.
//
// Pure string builder, validator-tested (scripts/validate-home-passport.ts).
// The strict rule: answer ONLY from retrieved records, cite refs, and PREFER
// the not-found line over guessing — a wrong brand/date in a homeowner's
// house record is worse than no answer.
//
// KEEP IN SYNC with supabase/functions/portal-ask-home/index.ts — edge
// functions can't import app code across the deploy boundary, so the edge fn
// carries a copy. The validator asserts the edge fn embeds the same not-found
// line and grounding rule so drift fails ship-check.

export const ASK_HOME_NOT_FOUND =
  "That's not in your home's records — ask your contractor.";

export interface AskHomeDoc {
  ref: string;
  content: string;
}

export function buildAskHomePrompt(question: string, docs: AskHomeDoc[]): string {
  const context = docs.length > 0
    ? docs.map(d => `[${d.ref}] ${d.content}`).join('\n\n')
    : '(no records found for this question)';
  return (
    'You are the memory of a home, answering the HOMEOWNER who lives there. ' +
    'Answer the question using ONLY the home records below. Never invent brands, ' +
    'dates, contacts, prices, or coverage terms. Write in plain, friendly language ' +
    'a homeowner understands — no contractor jargon. Lead with the direct answer, ' +
    'and cite the record reference in parentheses for each fact, e.g. ' +
    '(Warranty — Trane HVAC). If the records do not contain the answer, reply ' +
    `exactly: "${ASK_HOME_NOT_FOUND}" When unsure, prefer that reply over guessing.` +
    '\n\n' +
    `HOME RECORDS:\n${context}\n\n` +
    `HOMEOWNER QUESTION: ${question.trim()}`
  );
}
