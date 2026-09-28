// coApprovalRetry.ts: a client's change-order approval whose answer was lost
// (wave-next W2 integration, critic 2 issue 3).
//
// app/client-view.tsx inserts the approval into change_order_approvals,
// stamped with the send it answers (send_stamp, "<sentVersion>@<sentAt>", or
// 'unsent'). supabase/migrations/20260920060000_portal_live_overlay_v2.sql
// allows ONE decision per send (unique index change_order_approvals_one_per_send
// on project_id, change_order_id, send_stamp). So when an approval times out
// after its insert landed, the retry is refused by that index, and the old
// code told the client "Not approved. Something went wrong on our side." over
// an approval that is stored.
//
// The rule here: a duplicate on that insert means a decision for THIS send is
// already on file. Read it back and decide from what is stored:
//   - this portal's approve decision   -> the approval is stored: confirmed;
//   - any other decision on this send  -> refused, "already has a decision";
//   - nothing stored for this send     -> the duplicate was something else:
//                                         the generic refusal;
//   - unreadable                       -> no answer yet (never a guess).
//
// Pure: no react-native, no supabase import (the screen does the IO).

/** The index that allows one decision per send. */
export const ONE_DECISION_PER_SEND_INDEX = 'change_order_approvals_one_per_send';

/** The decision stored for a send, as read back (the columns the verdict needs). */
export interface StoredCODecision {
  decision: string;
  portal_id: string | null;
  signer_name: string | null;
  sealed_at: string | null;
}

/** The send a decision answers: portal_co_send_stamp's exact text. */
export function coSendStamp(co: { portalState?: { sentVersion?: number; sentAt?: string } | null }): string {
  return co.portalState ? `${co.portalState.sentVersion ?? 0}@${co.portalState.sentAt ?? ''}` : 'unsent';
}

/** A unique-key refusal of the approval insert: a decision for this send may already be on file. */
export function isDecisionAlreadyOnFile(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  if (!e) return false;
  const msg = typeof e.message === 'string' ? e.message : '';
  return e.code === '23505' || /duplicate key value violates unique constraint/i.test(msg) || msg.includes(ONE_DECISION_PER_SEND_INDEX);
}

export type COApprovalConflictVerdict = 'approved' | 'decided' | 'none';

/**
 * What the stored decision for this send means for the approval being retried.
 * `rows` is the read-back (oldest first); `portalId` is the portal this view signs for.
 */
export function coApprovalConflictVerdict(rows: readonly StoredCODecision[] | null | undefined, portalId: string): COApprovalConflictVerdict {
  const first = rows?.[0];
  if (!first) return 'none';
  return first.decision === 'approved' && !!portalId && first.portal_id === portalId ? 'approved' : 'decided';
}
