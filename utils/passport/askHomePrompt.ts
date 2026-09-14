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

/**
 * `commercial` switches the persona from a house to a building.
 *
 * The rest of the instruction is identical on purpose — the refusal rule, the
 * citation rule and the no-jargon rule are what make the answer trustworthy
 * and they do not change with the kind of property. Only the nouns do, and
 * they matter: a property manager asked "what paint is the kitchen" by their
 * own portal learns, correctly, that this tool was not built for them.
 *
 * The parameter is optional and defaults to the residential wording, so every
 * existing caller keeps its exact previous behaviour.
 */
export function buildAskHomePrompt(
  question: string,
  docs: AskHomeDoc[],
  opts: { commercial?: boolean } = {},
): string {
  const context = docs.length > 0
    ? docs.map(d => `[${d.ref}] ${d.content}`).join('\n\n')
    : '(no records found for this question)';

  const place = opts.commercial ? 'building' : 'home';
  const asker = opts.commercial ? 'OCCUPANT OR PROPERTY MANAGER' : 'HOMEOWNER';
  const plainly = opts.commercial
    ? 'a building occupant or property manager understands — no contractor jargon'
    : 'a homeowner understands — no contractor jargon';

  return (
    `You are the memory of a ${place}, answering the ${asker} responsible for it. ` +
    `Answer the question using ONLY the ${place} records below. Never invent brands, ` +
    'dates, contacts, prices, or coverage terms. Write in plain, friendly language ' +
    `${plainly}. Lead with the direct answer, ` +
    'and cite the record reference in parentheses for each fact, e.g. ' +
    '(Warranty — Trane HVAC). If the records do not contain the answer, reply ' +
    `exactly: "${ASK_HOME_NOT_FOUND}" When unsure, prefer that reply over guessing.` +
    '\n\n' +
    `${opts.commercial ? 'BUILDING' : 'HOME'} RECORDS:\n${context}\n\n` +
    `QUESTION: ${question.trim()}`
  );
}
