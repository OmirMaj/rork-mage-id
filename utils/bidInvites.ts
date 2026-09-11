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

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWriteDetailed, type WriteOutcome } from '@/utils/offlineQueue';
import { notifyEvent } from '@/utils/notifyClient';
import { generateUUID } from '@/utils/generateId';
import {
  BID_INVITE_TOKEN_BYTES,
  bidInviteUrl,
  inviteExpiryFrom,
  tokenFromBytes,
  type BidInviteRecord,
} from '@/utils/bidInviteCore';

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
   * True only when the `notify` dispatcher reported that it actually handled
   * the event. It answers an event its switch does not know with
   * `{ok:false, reason:'unknown_event'}` inside a 200, so this stays false
   * until supabase/functions/notify/index.ts grows a `bid_invite_sent` branch
   * — which it does not have today. Every screen that shows an invite must
   * therefore offer the link itself; see app/buyout-package.tsx.
   */
  emailed: boolean;
  url: string;
  inviteId: string;
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
  // `notify` has no `bid_invite_sent` branch yet, so this call currently comes
  // back false and the caller has to hand the GC the link. That is a worse
  // product than a mail merge and a far better one than telling him five subs
  // were emailed when none were.
  let emailed = false;
  if (outcome === 'synced') {
    emailed = await notifyEvent('bid_invite_sent', {
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
      sub_email: args.subEmail.trim(),
      sub_name: args.subName?.trim() ?? '',
      invite_url: url,
      expires_at: expiresAt,
      reply_to: args.replyToEmail ?? '',
    });
  }

  return { email: args.subEmail.trim(), outcome, emailed, url, inviteId };
}

/** Sequential on purpose: each invite is its own row, its own token and its own
 *  email, and a failure on the second address must not cost the first — hence
 *  the catch, which turns one bad recipient into one 'failed' result the screen
 *  can name instead of a rejected promise that abandons the rest. */
export async function sendBidInvites(
  base: Omit<SendBidInviteArgs, 'subEmail' | 'subName'>,
  recipients: { email: string; name?: string }[],
): Promise<SendBidInviteResult[]> {
  const results: SendBidInviteResult[] = [];
  for (const r of recipients) {
    try {
      results.push(await sendBidInvite({ ...base, subEmail: r.email, subName: r.name }));
    } catch (e) {
      console.warn('[bidInvites] invite failed for', r.email, e);
      results.push({ email: r.email.trim(), outcome: 'failed', emailed: false, url: '', inviteId: '' });
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
    return ((data ?? []) as InviteRow[]).map(r => ({
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
    }));
  } catch (e) {
    console.warn('[bidInvites] could not load invites for package', packageId, e);
    return null;
  }
}
