// utils/copilot/hubRouting.ts — what the Copilot hub does with a splitIntents
// result. Pure, so the copy for each failure is validated, not eyeballed.
//
// #118: with no signal, no AI allowance or an expired session, splitIntents
// returned [] and the hub said "Not sure which one that is — pick below", and
// picking a tile dropped what he had typed. Now a failed call says what failed,
// "Not sure" is reserved for a call that worked and matched nothing, and every
// tile carries the typed text as its seed.
import type { SplitAction } from './intentTable';

export type HubOutcome =
  | { kind: 'route'; action: SplitAction }
  | { kind: 'queue'; actions: SplitAction[] }
  | { kind: 'no_match' }
  | { kind: 'failed'; message: string };

export const NO_MATCH_COPY = 'Not sure which one that is — pick below.';
export const NO_SIGNAL_COPY = 'No signal — pick one below; what you typed comes with you.';
export const SESSION_EXPIRED_COPY = 'Session expired — sign in again.';
export const ROUTER_FAILED_COPY = 'Couldn’t sort that out — pick one below; what you typed comes with you.';

export function hubOutcome(res: { actions: SplitAction[]; errorKind?: string; error?: string }): HubOutcome {
  if (res.errorKind) {
    switch (res.errorKind) {
      case 'network':
      case 'timeout':
        return { kind: 'failed', message: NO_SIGNAL_COPY };
      case 'monthly_cap':
        // mageAI already built the cap sentence from the server's body.
        return { kind: 'failed', message: res.error?.trim() || 'Monthly AI limit reached.' };
      case 'unauthenticated':
        return { kind: 'failed', message: SESSION_EXPIRED_COPY };
      default:
        return { kind: 'failed', message: ROUTER_FAILED_COPY };
    }
  }
  if (res.actions.length === 1) return { kind: 'route', action: res.actions[0] };
  if (res.actions.length > 1) return { kind: 'queue', actions: res.actions };
  return { kind: 'no_match' };
}

/** The seed a grid tile opens with: whatever is in the box, or nothing. */
export function tileSeed(text: string): string | undefined {
  const t = (text ?? '').trim();
  return t ? t : undefined;
}

/** Ask MAGE needs a working AI call too, so it is offered only after a call
 *  that WORKED and matched no workflow — never after a failure. */
export function showAskMage(outcome: HubOutcome | null, questionShaped: boolean): boolean {
  return outcome?.kind === 'no_match' && questionShaped;
}
