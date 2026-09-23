// utils/bidInvitePending.ts — the invites filed OFFLINE that still owe the sub
// an email (#14). Pure: no storage, no network, so the guard can execute it.
//
// THE BUG. sendBidInvite mails only when the invite row reaches the server
// (a link mailed ahead of its row resolves to `bid_invite_denied`, which the sub
// reads as "they withdrew it"). An invite typed in a basement came back
// 'queued', so it was never mailed — not then, and not when the queue uploaded
// it an hour later. Worse, the list read only the server, so the GC could not
// see it and re-invited the same sub, minting a SECOND live token:
// bid_invite_submit blocks one submit per INVITE, not per bidder, so that sub
// could file two bids the matrix shows as two competing companies.
//
// THE FIX, in three moves (utils/bidInvites.ts does the I/O):
//   1. a queued invite is remembered on this phone — the invite record (token
//      included, the same token the offline queue already holds) and the notify
//      payload it would have sent;
//   2. once the row is on the server (the queue flushed, or the list reloaded)
//      the same `bid_invite_sent` event fires through remindBidInvites, which
//      reuses the EXISTING token — no second link — and the entry is cleared
//      only when notify says it handled the event;
//   3. until then the pending invite is IN the list ("On this phone — will
//      email when it uploads") and in splitAlreadyInvited's input, so a second
//      offline send cannot mint a second token.

import type { BidInviteRecord } from '@/utils/bidInviteCore';

/** One AsyncStorage key for the whole list. `mageid_` prefix: the tenant wipe
 *  (contexts/AuthContext wipeLocalUserCache) sweeps it by prefix. */
export const PENDING_BID_INVITES_KEY = 'mageid_bid_invites_pending';

/** The notify payload's shared half — what remindBidInvites needs to re-fire
 *  the invite email. Structurally the `base` bidInvites.ts sends with. */
export interface PendingNotifyBase {
  userId: string;
  packageId: string;
  projectId: string;
  packageName: string;
  projectName: string;
  csiDivision?: string;
  phase?: string;
  scopeDescription?: string;
  bidsDueAt?: string;
  replyToEmail?: string;
}

export interface PendingBidInvite {
  invite: BidInviteRecord;
  base: PendingNotifyBase;
  queuedAt: string;
  /** Delivery attempts after the row reached the server. */
  attempts: number;
  /** Why the last attempt did not email (notifyEventDetailed's reason). */
  lastReason?: string;
  /** notify ANSWERED no (unsubscribed, the send failed, no address). Retrying
   *  mails nobody; the row keeps a "Not emailed" marker until the sub answers
   *  or the link expires, and Chase remains his way to try again. */
  gaveUp?: boolean;
}

/**
 * Transport failures worth retrying later. A dispatcher refusal is an answer,
 * not a hiccup — retrying `suppressed_unsubscribed` mails nobody, forever.
 */
export function isRetryableNotifyReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return reason === 'unreachable' || reason === 'not_configured' || reason === 'http_429' || /^http_5\d\d$/.test(reason);
}

/** Whatever is on disk, as a list — a damaged value is an empty list, never a throw. */
export function parsePendingBidInvites(raw: string | null | undefined): PendingBidInvite[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((p): p is PendingBidInvite =>
      !!p && typeof p === 'object'
      && !!(p as PendingBidInvite).invite && typeof (p as PendingBidInvite).invite.id === 'string'
      && typeof (p as PendingBidInvite).invite.inviteToken === 'string'
      && !!(p as PendingBidInvite).base && typeof (p as PendingBidInvite).base.packageId === 'string');
  } catch {
    return [];
  }
}

function lapsed(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

/** A row the invite list renders: a server row, or a pending one that has not
 *  uploaded yet (`localOnly`), plus why it was not emailed when we know. */
export type DisplayInvite = BidInviteRecord & {
  localOnly?: boolean;
  notEmailedReason?: string;
};

/**
 * The invite list for one package: every server row, plus the pending invites
 * the server does not have yet. A pending entry notify refused is carried onto
 * its server row as `notEmailedReason`. Newest first, like fetchBidInvites.
 */
export function mergeInvitesWithPending(
  server: readonly BidInviteRecord[],
  pending: readonly PendingBidInvite[],
  packageId: string,
  nowMs: number,
): DisplayInvite[] {
  const onServer = new Set(server.map(r => r.id));
  const mine = pending.filter(p => p.base.packageId === packageId);
  const gaveUp = new Map(mine.filter(p => p.gaveUp).map(p => [p.invite.id, p.lastReason ?? 'refused']));
  const rows: DisplayInvite[] = server.map(r =>
    gaveUp.has(r.id) ? { ...r, notEmailedReason: gaveUp.get(r.id) } : { ...r });
  for (const p of mine) {
    if (onServer.has(p.invite.id) || lapsed(p.invite.expiresAt, nowMs)) continue;
    rows.push({ ...p.invite, localOnly: true });
  }
  return rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

/**
 * What to do with the pending list, given the server rows just read for a
 * package (or a project — pass every row read; entries for packages not in
 * `scopePackageIds` are left alone because the read did not cover them).
 *   deliver — on the server, unanswered, still live, not given up: email it.
 *   drop    — nothing left to say: the sub already answered, or the link
 *             lapsed (a dead token must not be mailed — it reads as a withdrawal).
 */
export function planPendingDelivery(
  pending: readonly PendingBidInvite[],
  server: readonly BidInviteRecord[],
  scopePackageIds: ReadonlySet<string>,
  nowMs: number,
): { deliver: { pending: PendingBidInvite; row: BidInviteRecord }[]; drop: string[] } {
  const byId = new Map(server.map(r => [r.id, r]));
  const deliver: { pending: PendingBidInvite; row: BidInviteRecord }[] = [];
  const drop: string[] = [];
  for (const p of pending) {
    if (!scopePackageIds.has(p.base.packageId)) continue;
    const row = byId.get(p.invite.id);
    if (!row) {
      // Not uploaded yet. Kept until its own link would have lapsed; after
      // that there is nothing to email and nothing to show.
      if (lapsed(p.invite.expiresAt, nowMs)) drop.push(p.invite.id);
      continue;
    }
    if (row.respondedAt || lapsed(row.expiresAt, nowMs)) { drop.push(p.invite.id); continue; }
    if (p.gaveUp) continue;
    deliver.push({ pending: p, row });
  }
  return { deliver, drop };
}

/**
 * Fold one delivery attempt back into the list. Emailed → removed (the ONLY
 * way an entry leaves while its invite is live). Refused → kept, marked
 * `gaveUp` so it is not re-sent on every focus, and the row says why.
 * A transport failure → kept for the next flush or focus.
 */
export function applyPendingDelivery(
  pending: readonly PendingBidInvite[],
  inviteId: string,
  outcome: { emailed: boolean; reason?: string },
): PendingBidInvite[] {
  if (outcome.emailed) return pending.filter(p => p.invite.id !== inviteId);
  return pending.map(p => p.invite.id !== inviteId ? p : {
    ...p,
    attempts: p.attempts + 1,
    lastReason: outcome.reason ?? 'refused',
    gaveUp: !isRetryableNotifyReason(outcome.reason),
  });
}

/** The row marker for an invite whose email did not go. */
export const NOT_EMAILED_ROW = 'Not emailed — copy link or Chase';

/** One sentence naming why an invite email did not go, for the alert (#94). */
export function notEmailedSentence(email: string, reason: string | undefined): string {
  if (reason === 'suppressed_unsubscribed') return `${email} unsubscribed from invitation emails — text them the link.`;
  if (reason === 'no_recipient') return `${email} has no address notify could mail — copy the link and text it over.`;
  return `Could not hand the email off to ${email} — copy the link and send it yourself.`;
}
