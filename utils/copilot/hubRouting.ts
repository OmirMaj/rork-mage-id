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

/** "Add three tasks after rough-in: A, B, C" can come back from the splitter
 *  as three 'schedule' actions — three queue cards, each opening the editor
 *  with one fragment ("drywall tape 3 days") that has lost its anchor, so the
 *  tasks were handled one at a time and landed nowhere near rough-in. Two or
 *  more schedule actions are ONE schedule request: the whole utterance when
 *  that is all he said, else his schedule fragments joined in spoken order
 *  (the other actions keep their own cards). Pure. */
export function mergeScheduleActions(actions: SplitAction[], utterance?: string): SplitAction[] {
  const sched = actions.filter(a => a.capabilityId === 'schedule');
  if (sched.length < 2) return actions;
  const whole = (utterance ?? '').trim();
  const text = sched.length === actions.length && whole ? whole : sched.map(a => a.text.trim()).join('; ');
  const merged: SplitAction = { ...sched[0], text, label: sched[0].label };
  const out: SplitAction[] = [];
  for (const a of actions) {
    if (a.capabilityId !== 'schedule') out.push(a);
    else if (a === sched[0]) out.push(merged);
  }
  return out;
}

/** A schedule card that opens the editor or the schedule LEAVES the hub for
 *  the Schedule tab — on iPhone by dismissing the hub sheet first (the native
 *  stacking fix, intentTable.hubScheduleNav). The other queued cards live only
 *  in the hub's state, so tapping the schedule card first threw them away:
 *  "add three tasks after rough-in and invoice the owner for demo" lost the
 *  invoice (review round 3). The queue therefore lists schedule cards LAST
 *  (order otherwise kept), and the card says why (SCHEDULE_CARD_LAST_COPY). */
export function scheduleCardsLast(actions: SplitAction[]): SplitAction[] {
  return [...actions.filter(a => a.capabilityId !== 'schedule'), ...actions.filter(a => a.capabilityId === 'schedule')];
}
export const SCHEDULE_CARD_LAST_COPY = 'Opens the schedule — handle the others first';

/** `utterance`: what he typed, so a multi-part schedule request stays whole
 *  (mergeScheduleActions). */
export function hubOutcome(res: { actions: SplitAction[]; errorKind?: string; error?: string }, utterance?: string): HubOutcome {
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
  const actions = mergeScheduleActions(res.actions, utterance);
  if (actions.length === 1) return { kind: 'route', action: actions[0] };
  if (actions.length > 1) return { kind: 'queue', actions: scheduleCardsLast(actions) };
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
