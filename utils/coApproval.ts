// The one line a change-order PDF (and any CO surface) prints for WHO approved
// an approved change order and how: the homeowner's own portal signature, a
// portal decision without a drawn signature, a named approver, or a manual
// mark by the GC. Pure — callers pass the CO; nothing here reads storage.
//
// Wave 4 #72: a client-signed CO used to look exactly like one the GC tapped
// "Mark approved" on — the CO screen showed only the green "Approved" badge,
// and when the client later disputed the extra, nothing in the app showed that
// they had signed. The sealed entry the portal RPC appends
// (submit_change_order_approval → 'client_signed_via_portal', actor = the
// signer, timestamp = the server's sealed_at, detail "… record SHA-256
// <16 hex>…") is the evidence; this module reads it.
//
// CONTRACT 6 (dfr's CO PDF imports it): the exported interface and the
// coApprovalLine signature are frozen. CONTRACT 7 (frozen audit actions):
// server-sealed 'client_signed_via_portal' / 'client_declined_via_portal';
// the reconciler's 'approved_via_portal' / 'declined_via_portal' (actor =
// signer) and 'portal_decision_applied'; context-records' 'marked_approved'
// (actor = the GC).
import type { ChangeOrder, COAuditEntry } from '@/types';
import { calendarDayOf, formatCalendarDay } from '@/utils/calendarDate';

export interface CoApprovalLine {
  kind: 'client_signed' | 'client_portal' | 'approver' | 'manual';
  text: string;
  who?: string;
  day?: string;
  hash?: string;
}

/**
 * Audit actions that record the CO BECOMING approved, strongest evidence first
 * (#75: utils/aiaBilling dates a CO into a pay-application period from these).
 * An explicit allow-list, never /approve/i — that regex missed the sealed
 * e-sign action and matched 'unapproved' / 'disapproved'. Never a decline, and
 * never 'portal_decision_applied' (it also exists for declines and for "status
 * was already set"; the sealed entry always accompanies it).
 *
 *   'marked_approved'   — the GC's own non-portal approval (context-records).
 *   'approved', 'manually_approved' — legacy manual spellings (none are in
 *                         production today; kept so an old device's entry
 *                         still dates its CO).
 */
export const CO_APPROVAL_ACTIONS = [
  'client_signed_via_portal',
  'approved_via_portal',
  'marked_approved',
  'approved',
  'manually_approved',
] as const;

/** The newest entry with this action (by timestamp), or null. */
function newestOf(trail: readonly COAuditEntry[] | undefined, action: string): COAuditEntry | null {
  let best: COAuditEntry | null = null;
  for (const e of trail ?? []) {
    if (!e || e.action !== action) continue;
    if (!best || String(e.timestamp ?? '').localeCompare(String(best.timestamp ?? '')) > 0) best = e;
  }
  return best;
}

/** The record hash the sealed entry's detail carries ("record SHA-256 <hex>…"). */
export function coApprovalHash(detail: string | undefined): string | undefined {
  const m = /record SHA-256 ([0-9a-f]{8,64})/i.exec(detail ?? '');
  return m ? m[1].toLowerCase() : undefined;
}

function dayOf(value: string | undefined | null): string | undefined {
  return calendarDayOf(value ?? null) ?? undefined;
}

function onDay(day: string | undefined): string {
  return day ? ` on ${formatCalendarDay(day)}` : '';
}

/** null unless `co.status` is 'approved'. */
export function coApprovalLine(
  co: Pick<ChangeOrder, 'status' | 'auditTrail' | 'approvers'>,
): CoApprovalLine | null {
  if (co.status !== 'approved') return null;

  const sealed = newestOf(co.auditTrail, 'client_signed_via_portal');
  if (sealed) {
    const who = sealed.actor?.trim() || 'the client';
    const day = dayOf(sealed.timestamp);
    const hash = coApprovalHash(sealed.detail);
    return {
      kind: 'client_signed',
      who, day, hash,
      text: `Electronically signed by ${who} in the client portal${onDay(day)}`
        + (hash ? ` — record SHA-256 ${hash}…` : '') + '.',
    };
  }

  const portal = newestOf(co.auditTrail, 'approved_via_portal');
  if (portal) {
    const who = portal.actor?.trim() || 'the client';
    const day = dayOf(portal.timestamp);
    return {
      kind: 'client_portal', who, day,
      text: `Approved by ${who} in the client portal${onDay(day)}. No drawn signature is on file for this decision.`,
    };
  }

  const approver = [...(co.approvers ?? [])]
    .filter(a => a.role === 'Client' && a.status === 'approved')
    .sort((a, b) => String(b.responseDate ?? '').localeCompare(String(a.responseDate ?? '')))[0];
  if (approver) {
    const who = approver.name?.trim() || approver.email?.trim() || 'the client';
    const day = dayOf(approver.responseDate);
    return { kind: 'approver', who, day, text: `Approved by ${who}${onDay(day)}.` };
  }

  // Nothing from the client. Say so — never dress a manual mark up as a
  // signature. Name who marked it only from the trail's own 'marked_approved'
  // entry: the line is also printed on the CO PDF, and a legacy approval (or
  // one made before that entry was written) has no record of who did it, so
  // it must not claim "you" as fact.
  const marked = newestOf(co.auditTrail, 'marked_approved');
  const day = dayOf(marked?.timestamp);
  const who = marked?.actor?.trim() || undefined;
  return {
    kind: 'manual',
    who,
    day,
    text: who
      ? `Marked approved by ${who}${onDay(day)}, no client signature on file.`
      : `Marked approved in MAGE${onDay(day)}, no client signature on file.`,
  };
}
