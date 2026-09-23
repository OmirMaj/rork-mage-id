// utils/bidInvites.ts — the I/O half of invitation to bid: mint a token, file
// the invite, hand the link to the sub.
//
// The arithmetic lives in ./bidInviteCore (pure, and executed by the guard).
// This file is the three side effects:
//
//   1. a CSPRNG token — expo-crypto, never Math.random. utils/generateId.ts
//      falls back to Math.random when crypto.randomUUID is missing, which is
//      fine for a row id and not fine for the only credential standing between
//      a stranger and a write into the GC's bid table.
//   2. the invite row — through utils/offlineQueue.ts like every other write in
//      this app, so an invite typed in a basement with no signal is not lost.
//   3. the email — through the `notify` edge function, the one path outbound
//      mail leaves this product by (utils/notifyClient.ts).
//
// Reads are NOT queued: `fetchBidInvites` is a plain select, and the RLS policy
// on bid_package_invites scopes it to the signed-in GC.

import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWriteDetailed, type WriteOutcome } from '@/utils/offlineQueue';
import { notifyEventDetailed } from '@/utils/notifyClient';
import { generateUUID } from '@/utils/generateId';
import {
  BID_INVITE_TOKEN_BYTES,
  bidInviteUrl,
  inviteExpiryFrom,
  tokenFromBytes,
  type BidInviteRecord,
  type InviteRecipient,
} from '@/utils/bidInviteCore';
import {
  PENDING_BID_INVITES_KEY,
  applyPendingDelivery,
  parsePendingBidInvites,
  planPendingDelivery,
  type PendingBidInvite,
  type PendingNotifyBase,
} from '@/utils/bidInvitePending';

/** 24 bytes of CSPRNG, hex-encoded. `tokenFromBytes` throws rather than return
 *  anything the RPC's ≥16-char floor would refuse. */
export async function newInviteToken(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(BID_INVITE_TOKEN_BYTES);
  return tokenFromBytes(bytes);
}

export interface SendBidInviteArgs {
  /** The signed-in GC. Stamped on the row, and it is this id the submit RPC
   *  copies onto the bid — never anything the bidder sends. */
  userId: string;
  packageId: string;
  projectId: string;
  packageName: string;
  projectName: string;
  csiDivision?: string;
  phase?: string;
  scopeDescription?: string;
  /**
   * `BidPackage.dueDate` — when the GC actually wants the number.
   *
   * The invite used to carry one date and it was the wrong one: "It stops
   * working 30 days from today", which is the link's expiry, not a deadline.
   * A sub who needs three days reads thirty and files it.
   *
   * It rides in the `bid_invite_sent` payload as `bids_due_at`; notify's
   * branch prints it as a "Bids due" row (bidDueDayLabel), and the sub's bid
   * page reads the same day from `bid_invite_get`'s `bids_due_on` (#99).
   */
  bidsDueAt?: string;
  subEmail: string;
  subName?: string;
  subcontractorId?: string;
  /** GC's own reply-to, so the sub can ask a scope question by hitting reply. */
  replyToEmail?: string;
}

export interface SendBidInviteResult {
  email: string;
  /** Where the row got to. 'queued' means the invite is on this device only —
   *  the link works the moment the queue drains, and not one second before. */
  outcome: WriteOutcome;
  /**
   * True only when the `notify` dispatcher reported that it handled the event
   * (notifyEventDetailed). A 200 carrying `{ok:false}` is not a send — notify
   * answers an unsubscribed sub, a refused send or a missing address that way
   * (#94; the bid_invite_sent not-delivered return is w5-join-server's). False
   * for a QUEUED invite too: it is emailed later, once the row uploads
   * (deliverPendingBidInvites). Every screen that shows an invite must
   * therefore offer the link itself; see app/buyout-package.tsx.
   */
  emailed: boolean;
  /** Why it was not emailed — notify's reason or a transport failure. */
  reason?: string;
  url: string;
  inviteId: string;
}

// ── Invites filed offline, still owing the sub an email (#14) ────────────────
// The list lives under one mageid_ key (utils/bidInvitePending.ts has the
// arithmetic and the why). Every read-modify-write runs through one promise
// chain so the send path and a delivery pass can never clobber each other.
let pendingLock: Promise<unknown> = Promise.resolve();
function withPendingLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = pendingLock.then(fn, fn);
  pendingLock = run.then(() => undefined, () => undefined);
  return run;
}

/** Every pending invite on this device. Empty — never a throw — when storage
 *  is unavailable: a missing list costs a reminder, not the screen. */
export async function loadPendingBidInvites(): Promise<PendingBidInvite[]> {
  try {
    return parsePendingBidInvites(await AsyncStorage.getItem(PENDING_BID_INVITES_KEY));
  } catch (e) {
    console.warn('[bidInvites] could not read pending invites', e);
    return [];
  }
}

async function updatePendingBidInvites(fn: (list: PendingBidInvite[]) => PendingBidInvite[]): Promise<PendingBidInvite[]> {
  return withPendingLock(async () => {
    const next = fn(await loadPendingBidInvites());
    try {
      if (next.length === 0) await AsyncStorage.removeItem(PENDING_BID_INVITES_KEY);
      else await AsyncStorage.setItem(PENDING_BID_INVITES_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('[bidInvites] could not save pending invites', e);
    }
    return next;
  });
}

function baseOf(args: SendBidInviteArgs): PendingNotifyBase {
  return {
    userId: args.userId,
    packageId: args.packageId,
    projectId: args.projectId,
    packageName: args.packageName,
    projectName: args.projectName,
    csiDivision: args.csiDivision,
    phase: args.phase,
    scopeDescription: args.scopeDescription,
    bidsDueAt: args.bidsDueAt,
    replyToEmail: args.replyToEmail,
  };
}

/**
 * One invite: token, row, mail. Returns what actually happened for each,
 * because the three can disagree — a filed invite whose email bounced is still
 * a usable link the GC can text, and the screen has to be able to say so.
 */
export async function sendBidInvite(args: SendBidInviteArgs): Promise<SendBidInviteResult> {
  // The write path answers 'failed' rather than throwing (utils/offlineQueue.ts),
  // but minting the token does not: expo-crypto rejects when the native module
  // is missing, and `tokenFromBytes` throws on a short byte count. Either one
  // used to reject this promise, and because sendBidInvites awaits them in a
  // loop, one bad recipient abandoned every recipient after it with nothing on
  // screen to say so.
  let token: string;
  try {
    token = await newInviteToken();
  } catch (e) {
    console.warn('[bidInvites] could not mint an invite token', e);
    return { email: args.subEmail.trim(), outcome: 'failed', emailed: false, url: '', inviteId: '' };
  }
  const inviteId = generateUUID();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = inviteExpiryFrom(now);
  const url = bidInviteUrl(token);

  const outcome = await supabaseWriteDetailed('bid_package_invites', 'insert', {
    id: inviteId,
    user_id: args.userId,
    package_id: args.packageId,
    project_id: args.projectId,
    sub_name: args.subName?.trim() || null,
    sub_email: args.subEmail.trim(),
    subcontractor_id: args.subcontractorId ?? null,
    invite_token: token,
    status: 'sent',
    expires_at: expiresAt,
    created_at: nowIso,
    updated_at: nowIso,
  });

  // Mail only once the row is actually on the server. A link emailed ahead of
  // its invite row resolves to `bid_invite_denied`, which the sub page can only
  // render as "this invitation is no longer valid" — the sub reads that as
  // "they withdrew it" and does not bid.
  //
  // `emailed` is what notify SAID, read through notifyEventDetailed (#94): a
  // 200 whose envelope says it did not handle the event — or, once
  // w5-join-server lands it, that the sub unsubscribed or the send failed — is
  // not a send, and the reason rides back so the screen can say which.
  //
  // A QUEUED invite is remembered here (#14) and emailed by
  // deliverPendingBidInvites once the queue uploads the row — through the SAME
  // token, so the sub never holds two links.
  let emailed = false;
  let reason: string | undefined;
  const inviteRecord: BidInviteRecord = {
    id: inviteId,
    packageId: args.packageId,
    projectId: args.projectId,
    subName: args.subName?.trim() || null,
    subEmail: args.subEmail.trim(),
    subcontractorId: args.subcontractorId ?? null,
    inviteToken: token,
    status: 'sent',
    expiresAt,
    respondedAt: null,
    bidId: null,
    createdAt: nowIso,
  };
  if (outcome === 'queued') {
    const entry: PendingBidInvite = { invite: inviteRecord, base: baseOf(args), queuedAt: nowIso, attempts: 0 };
    await updatePendingBidInvites(list => [...list.filter(p => p.invite.id !== inviteId), entry]);
    reason = 'queued';
  }
  if (outcome === 'synced') {
    const sent = await notifyEventDetailed('bid_invite_sent', {
      project_id: args.projectId,
      project_name: args.projectName,
      gc_user_id: args.userId,
      package_id: args.packageId,
      package_name: args.packageName,
      csi_division: args.csiDivision ?? '',
      phase: args.phase ?? '',
      // Scope only. The package's estimate budget is the GC's own number and is
      // deliberately absent from the email for the same reason bid_invite_get
      // withholds it: it would anchor every bid he gets back just under it.
      scope_description: args.scopeDescription ?? '',
      bids_due_at: args.bidsDueAt ?? '',
      sub_email: args.subEmail.trim(),
      sub_name: args.subName?.trim() ?? '',
      invite_url: url,
      expires_at: expiresAt,
      reply_to: args.replyToEmail ?? '',
    });
    emailed = sent.handled;
    reason = sent.handled ? undefined : sent.reason;
  }

  return { email: args.subEmail.trim(), outcome, emailed, reason, url, inviteId };
}

/** Sequential on purpose: each invite is its own row, its own token and its own
 *  email, and a failure on the second address must not cost the first — hence
 *  the catch, which turns one bad recipient into one 'failed' result the screen
 *  can name instead of a rejected promise that abandons the rest. */
export async function sendBidInvites(
  base: Omit<SendBidInviteArgs, 'subEmail' | 'subName' | 'subcontractorId'>,
  recipients: InviteRecipient[],
): Promise<SendBidInviteResult[]> {
  const results: SendBidInviteResult[] = [];
  for (const r of recipients) {
    try {
      // The roster id is PER RECIPIENT, not on the shared base — that is the
      // whole fix. It used to sit on `base` and was never set, so every invite
      // row, every bid the RPC copied it onto, and every commitment the award
      // copied it onto again named a company and referenced no record.
      results.push(await sendBidInvite({
        ...base, subEmail: r.email, subName: r.name, subcontractorId: r.subcontractorId,
      }));
    } catch (e) {
      console.warn('[bidInvites] invite failed for', r.email, e);
      results.push({ email: r.email.trim(), outcome: 'failed', emailed: false, url: '', inviteId: '' });
    }
  }
  return results;
}

/** What a chase did for one sub. `emailed:false` means the link is still live
 *  and still uncarried — the screen has to offer the copy button, same as a
 *  first send. */
export interface RemindInviteResult {
  inviteId: string;
  email: string;
  emailed: boolean;
  /** Why it was not emailed (notifyEventDetailed's reason), when it was not. */
  reason?: string;
  url: string;
}

/**
 * Chase the subs who have not answered.
 *
 * Re-fires the SAME `bid_invite_sent` event against the invite row's EXISTING
 * token — no new row, no new token, no second bid slot. Routing a reminder
 * through `sendBidInvites` would either be refused by `splitAlreadyInvited` or
 * mint a second live link for a sub who already holds one, and
 * `bid_invite_submit` blocks a second submit per INVITE rather than per bidder,
 * so that sub could then file two bids that the levelling matrix shows as two
 * competing companies.
 *
 * Nothing is written: `bid_package_invites` has no reminded_at column, so this
 * is a send and not a state change. The screen says "re-sent just now" for the
 * session and does not pretend to remember it tomorrow.
 */
export async function remindBidInvites(
  base: Omit<SendBidInviteArgs, 'subEmail' | 'subName' | 'subcontractorId'>,
  invites: readonly BidInviteRecord[],
): Promise<RemindInviteResult[]> {
  const out: RemindInviteResult[] = [];
  for (const inv of invites) {
    const url = bidInviteUrl(inv.inviteToken);
    let emailed = false;
    let reason: string | undefined;
    try {
      const sent = await notifyEventDetailed('bid_invite_sent', {
        project_id: base.projectId,
        project_name: base.projectName,
        gc_user_id: base.userId,
        package_id: base.packageId,
        package_name: base.packageName,
        csi_division: base.csiDivision ?? '',
        phase: base.phase ?? '',
        scope_description: base.scopeDescription ?? '',
        bids_due_at: base.bidsDueAt ?? '',
        sub_email: inv.subEmail,
        sub_name: inv.subName ?? '',
        invite_url: url,
        expires_at: inv.expiresAt ?? '',
        reply_to: base.replyToEmail ?? '',
      });
      emailed = sent.handled;
      reason = sent.handled ? undefined : sent.reason;
    } catch (e) {
      console.warn('[bidInvites] reminder failed for', inv.subEmail, e);
      reason = 'unreachable';
    }
    out.push({ inviteId: inv.id, email: inv.subEmail, emailed, reason, url });
  }
  // A chase that got through also settles a pending offline invite for the
  // same row (and one that did not keeps its "not emailed" reason current).
  if (out.length > 0) {
    await updatePendingBidInvites(list => out.reduce(
      (acc, r) => acc.some(p => p.invite.id === r.inviteId) ? applyPendingDelivery(acc, r.inviteId, r) : acc,
      list,
    ));
  }
  return out;
}

// Invite ids being delivered right now, across every screen. The package
// screen and the buyout list both run a delivery pass on focus; without this
// the same sub could be mailed twice for one upload.
const delivering = new Set<string>();

/**
 * Email the offline invites that have now reached the server (#14).
 *
 * `serverRows` is what a read just returned and `scopePackageIds` the packages
 * that read covered — an entry for a package the read did not cover is left
 * alone rather than judged against rows that were never fetched. Each invite
 * is mailed through remindBidInvites, i.e. the `bid_invite_sent` event against
 * its EXISTING token; the entry is cleared only when notify handled it.
 */
export async function deliverPendingBidInvites(
  serverRows: readonly BidInviteRecord[],
  scopePackageIds: ReadonlySet<string>,
  nowMs: number = Date.now(),
): Promise<RemindInviteResult[]> {
  const pending = await loadPendingBidInvites();
  if (pending.length === 0) return [];
  const { deliver, drop } = planPendingDelivery(pending, serverRows, scopePackageIds, nowMs);
  if (drop.length > 0) {
    const gone = new Set(drop);
    await updatePendingBidInvites(list => list.filter(p => !gone.has(p.invite.id)));
  }
  const results: RemindInviteResult[] = [];
  for (const { pending: p, row } of deliver) {
    if (delivering.has(row.id)) continue;
    delivering.add(row.id);
    try {
      // Re-read under the latch: another pass may have mailed and cleared it
      // between our read above and now.
      const still = (await loadPendingBidInvites()).some(x => x.invite.id === row.id && !x.gaveUp);
      if (!still) continue;
      // remindBidInvites folds its own result back into the pending list.
      results.push(...await remindBidInvites(p.base, [row]));
    } finally {
      delivering.delete(row.id);
    }
  }
  return results;
}

interface InviteRow {
  id: string;
  package_id: string;
  project_id: string;
  sub_name: string | null;
  sub_email: string;
  subcontractor_id: string | null;
  invite_token: string;
  status: string;
  expires_at: string | null;
  responded_at: string | null;
  bid_id: string | null;
  created_at: string | null;
}

/**
 * Invites for one package, newest first.
 *
 * `null` means WE COULD NOT READ — distinct from `[]`, which means nobody has
 * been invited. The screen has to be able to tell those apart: rendering a
 * dropped read as "Nobody invited yet" tells a GC his RFQ never went out and
 * sends him to re-invite subs who already have a live link (the 2026-09-07
 * honesty-gap theme; scripts/validate-read-failure-honesty.ts).
 *
 * No backend configured at all is a real, knowable empty — there is nowhere an
 * invite could have been filed — so that answers `[]`.
 */
export async function fetchBidInvites(packageId: string): Promise<BidInviteRecord[] | null> {
  if (!isSupabaseConfigured || !packageId) return [];
  try {
    const { data, error } = await supabase
      .from('bid_package_invites')
      .select('*')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as InviteRow[]).map(mapInviteRow);
  } catch (e) {
    console.warn('[bidInvites] could not load invites for package', packageId, e);
    return null;
  }
}

/**
 * Every invite on a project, in ONE read.
 *
 * The buyout list had no invite information at all, so answering "who still
 * owes me a number" meant opening eight packages one at a time, each firing its
 * own `fetchBidInvites`. This is deliberately a single project-scoped select
 * rather than a loop over the package list: eight reads to render one screen is
 * how a list becomes unusable on a job-site connection, and the RLS policy
 * scopes the rows to the signed-in GC either way.
 *
 * Same honesty contract as `fetchBidInvites`: `null` means WE COULD NOT READ.
 * The list must not render a dropped read as "nobody invited".
 */
export async function fetchBidInvitesForProject(projectId: string): Promise<BidInviteRecord[] | null> {
  if (!isSupabaseConfigured || !projectId) return [];
  try {
    const { data, error } = await supabase
      .from('bid_package_invites')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as InviteRow[]).map(mapInviteRow);
  } catch (e) {
    console.warn('[bidInvites] could not load invites for project', projectId, e);
    return null;
  }
}

function mapInviteRow(r: InviteRow): BidInviteRecord {
  return {
    id: r.id,
    packageId: r.package_id,
    projectId: r.project_id,
    subName: r.sub_name,
    subEmail: r.sub_email,
    subcontractorId: r.subcontractor_id,
    inviteToken: r.invite_token,
    status: r.status,
    expiresAt: r.expires_at,
    respondedAt: r.responded_at,
    bidId: r.bid_id,
    createdAt: r.created_at,
  };
}
