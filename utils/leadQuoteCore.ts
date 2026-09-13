// utils/leadQuoteCore.ts — writing and reading back the price a GC quoted a
// lead, through the only store that currently survives a sync.
//
// QUOTE-PERSIST-1 (audit 2026-09-07, "worth doing" #15). "Mark proposal sent"
// in components/InstantBidProposalModal.tsx recorded ONE SENTENCE — "Sent
// Instant Bid proposal — Better $48,000." — on the lead's touch log and
// nothing else. The tier inclusions, the assumptions and the grounding basis
// were discarded the moment the sheet closed, so a GC asked three weeks later
// what he had quoted could not answer from the app, and convertLeadToProject
// still seeded targetBudget from the HOMEOWNER's budget range rather than the
// GC's own number.
//
// THIS IS A WORKAROUND AND IS LABELLED AS ONE. The proper fix is
// `quotedAmount` / `quotedTier` / `quotedAt` on `Lead`, which needs
// types/index.ts, the leads row mapping in contexts/ProjectContext.tsx (both
// the SELECT map and the `supabaseWrite('leads', 'update', …)` column list)
// and a `quoted_amount` column — a shape change plus a migration. Until that
// exists, `Lead.touches` is the only field that round-trips to the server, so
// the whole quote goes into a touch body in a fixed, parseable shape. When the
// column lands, DELETE both helpers rather than extending them: two stores for
// one number is how they end up disagreeing.
//
// Lives outside the modal so a guard can EXECUTE it — bun cannot parse a .tsx
// that pulls react-native (same reason utils/billingFlowCore.ts exists).

import { formatMoney, parseLenientNumber } from '@/utils/formatters';
import type { LeadTouch, ProposalTier, TieredProposal } from '@/types';

/**
 * The line `quotedFromTouches` looks for.
 *
 * Fixed text, anchored to the START of its own line. A touch body is free text
 * the GC also types by hand ("they said $48,000 was too high"), and a bare
 * dollar figure appearing anywhere in a note must never be read back as a
 * price he quoted.
 */
export const QUOTE_LINE = 'Quoted:';

/**
 * The activity-log entry for a sent proposal: everything the GC would need to
 * answer "what did I quote them?" without opening the AI again.
 *
 * Line 1 is the human sentence the timeline shows. `Quoted:` is line 2 so the
 * parse is anchored, and the inclusions / assumptions / basis follow.
 */
export function quoteTouchBody(tier: ProposalTier, proposal: TieredProposal): string {
  const lines = [
    `Sent Instant Bid proposal — ${tier.label} tier.`,
    `${QUOTE_LINE} ${formatMoney(tier.amount)}`,
  ];
  if (tier.inclusions.length > 0) lines.push(`Includes: ${tier.inclusions.join('; ')}`);
  if (proposal.assumptions.length > 0) lines.push(`Assumes: ${proposal.assumptions.join('; ')}`);
  // The grounding chip the GC saw before he sent it, recorded WITH the number
  // it qualifies. A quote that was a naked AI guess must not read, three weeks
  // later, like one anchored on his own learned rates.
  lines.push(
    proposal.basis === 'history'
      ? `Basis: anchored on ${proposal.groundingRateCount ?? 0} learned rate${proposal.groundingRateCount === 1 ? '' : 's'} from similar jobs.`
      : proposal.basis === 'budget'
        ? 'Basis: blended toward the budget range provided.'
        : 'Basis: AI estimate with no budget or cost history to anchor it.',
  );
  return lines.join('\n');
}

export interface QuotedFromTouches {
  amount: number;
  /** ISO timestamp of the touch that carried it. */
  occurredAt: string;
  /** The rest of the entry — inclusions, assumptions, basis — as one line. */
  detail: string;
}

/**
 * The most recent quote in a lead's activity log, or null.
 *
 * Sorts by `occurredAt` rather than trusting insertion order. `addLeadTouch`
 * prepends today, but a re-quote reading back as the ORIGINAL price is the one
 * failure this helper must not have, and that guarantee should not depend on
 * another module's array order.
 */
export function quotedFromTouches(touches: LeadTouch[] | undefined): QuotedFromTouches | null {
  if (!touches || touches.length === 0) return null;
  const rx = new RegExp(`^${QUOTE_LINE}\\s*(.+)$`, 'm');
  const hits: QuotedFromTouches[] = [];
  for (const t of touches) {
    const body = t.body ?? '';
    const m = rx.exec(body);
    if (!m) continue;
    const amount = parseLenientNumber(m[1]);
    if (amount == null || amount <= 0) continue;
    const detail = body
      .split('\n')
      .filter(l => l.startsWith('Includes:') || l.startsWith('Assumes:') || l.startsWith('Basis:'))
      .join(' ');
    hits.push({ amount, occurredAt: t.occurredAt, detail });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return hits[0];
}
