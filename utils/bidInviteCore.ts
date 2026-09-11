// utils/bidInviteCore.ts — the pure half of invitation-to-bid.
//
// Audit 2026-09-07 worth-doing #24: `addBidPackageBid` has two callers, both
// forms on app/buyout-package.tsx, so every competing bid in the buyout matrix
// is typed by the GC off a PDF. Twelve packages by three bids is thirty-six
// hand entries before the levelling differentiator has anything to level.
//
// The server half (supabase/migrations/20260908120000_bid_package_invites.sql)
// trades a random token for exactly one narrow insert. Everything in THIS file
// is the arithmetic around that token — how long it is, what URL carries it,
// when it lapses, which addresses the GC actually typed, and what the buyout
// screen should say about an invite that has gone quiet. No React, no expo, no
// Supabase: scripts/validate-bid-invite.ts imports and runs it under bun, which
// is the only way a guard can prove the token the client mints clears the floor
// the RPC enforces rather than merely observing that a constant says 16.

/**
 * The floor BOTH RPCs enforce before they will look a token up:
 *
 *     if p_token is null or length(p_token) < 16 then
 *       raise exception 'bid_invite_denied';
 *
 * A client that mints anything shorter emails a link that is dead on arrival —
 * and dead in the one way the sub cannot tell from "the GC withdrew it", since
 * every failure raises the same `bid_invite_denied`. Keep this equal to the
 * number in the migration; the guard fails the build if the two drift.
 */
export const BID_INVITE_MIN_TOKEN_CHARS = 16;

/**
 * 24 CSPRNG bytes → 48 hex characters, the same 192 bits the sub-portal access
 * token carries. Three times the RPC's floor, so shortening the encoding (or
 * swapping hex for something denser) cannot silently walk under it.
 */
export const BID_INVITE_TOKEN_BYTES = 24;

/** The static page that trades the token for the scope. Netlify serves the
 *  directory index, so the token rides as `?t=` rather than in the path. */
export const BID_INVITE_URL_BASE = 'https://mageid.app/bid-invite/';

/**
 * How long an invite stays live. Thirty days is the same window the buyout
 * screen already cites for material pricing — a bid returned against numbers
 * older than that is not a bid the GC should be levelling.
 */
export const BID_INVITE_EXPIRY_DAYS = 30;

/** Hex, lower case. Throws rather than returning a short token: a caller that
 *  hands us four bytes has a bug, and letting it through produces an invite row
 *  whose link the RPC will refuse forever. */
export function tokenFromBytes(bytes: Uint8Array | number[]): string {
  let out = '';
  for (const b of bytes) {
    out += (b & 0xff).toString(16).padStart(2, '0');
  }
  if (out.length < BID_INVITE_MIN_TOKEN_CHARS) {
    throw new Error(
      `bid invite token too short: ${out.length} chars, the RPC refuses anything under ${BID_INVITE_MIN_TOKEN_CHARS}`,
    );
  }
  return out;
}

export function bidInviteUrl(token: string): string {
  return `${BID_INVITE_URL_BASE}?t=${encodeURIComponent(token)}`;
}

/**
 * `expires_at` is an INSTANT (timestamptz), not a calendar day: the RPC
 * compares it with `now()`. Thirty days of milliseconds from the send is
 * deliberately not "the 30th day at midnight local" — nobody should read this
 * as a date the sub can work back from, and a DST boundary would shift a
 * calendar-day count against the instant the server actually checks.
 */
export function inviteExpiryFrom(sentAtMs: number): string {
  return new Date(sentAtMs + BID_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Deliberately loose: one @, a dot in the domain, no spaces. The GC is typing
// addresses off a business card, and a validator strict enough to argue with
// RFC 5322 rejects real addresses far more often than it catches typos.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** One address the GC meant to invite, plus the display name if he pasted one. */
export interface InviteRecipient {
  email: string;
  /** Lands in `bid_package_invites.sub_name`, which is what the bidder's page
   *  greets by name and what `bid_invite_submit` falls back to when the sub
   *  leaves the company field empty. */
  name?: string;
}

/**
 * Strip the decoration a real paste carries. Every one of these produced an
 * address the mail service refuses while the invite row was filed anyway, so
 * the GC was told "1 invite filed" for a link that could never be delivered:
 *   `<joe@ace.com>`      — angle brackets from a mail-client paste
 *   `mailto:joe@ace.com` — a copied link rather than a copied address
 *   `joe@ace.com.`       — a sentence's full stop, or a comma from a list
 */
function cleanAddress(raw: string): string {
  return raw
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^[<("'\u2018\u201C]+/, '')
    .replace(/[>)"'\u2019\u201D]+$/, '')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

function cleanName(raw: string): string {
  const n = raw.replace(/["'\u2018\u2019\u201C\u201D]/g, '').replace(/^[\s,;]+|[\s,;]+$/g, '').trim();
  // "joe@ace.com <joe@ace.com>" is a paste artefact, not a name; putting an
  // address in the greeting reads like a mail-merge that misfired.
  if (!n || n.includes('@')) return '';
  return n.slice(0, 120);
}

/**
 * The GC pastes "joe@ace.com, maria@bpl.com", one per line, or straight out of
 * his mail client as `Joe Smith <joe@ace.com>`. Returns the recipients to
 * invite plus the fragments that were not addresses, so the screen can say
 * WHICH one it dropped instead of silently sending two of three.
 * De-duplicated case-insensitively — inviting the same sub twice mints two live
 * tokens, and two tokens let one bidder file two bids, which the buyout matrix
 * shows as two competing subs.
 */
export function parseInviteEmails(raw: string): { recipients: InviteRecipient[]; rejected: string[] } {
  // Pull `Name <addr>` pairs out first, leaving a placeholder in position so
  // the remaining bare addresses keep their order. Commas are excluded from the
  // name so that "joe@ace.com, Maria <maria@bpl.com>" does not swallow joe.
  const bracketed: { email: string; name: string; text: string }[] = [];
  const residue = String(raw ?? '').replace(/([^<>,;\n]*)<([^<>]*)>/g, (whole, nm: string, addr: string) => {
    bracketed.push({ email: cleanAddress(addr), name: cleanName(nm), text: String(whole).trim() });
    return ` \u0001${bracketed.length - 1}\u0001 `;
  });

  const recipients: InviteRecipient[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  const take = (email: string, name: string, original: string) => {
    if (!EMAIL_RE.test(email)) { rejected.push(original); return; }
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    recipients.push(name ? { email, name } : { email });
  };

  for (const part of residue.split(/[\s,;]+/).map(p => p.trim()).filter(Boolean)) {
    const ref = part.match(/^\u0001(\d+)\u0001$/);
    if (ref) {
      const b = bracketed[Number(ref[1])];
      if (b) take(b.email, b.name, b.text);
      continue;
    }
    const addr = cleanAddress(part);
    // A leftover word with no `@` and no `.` is the other half of a pasted
    // display name ("Smith," from "Smith, Joe <joe@ace.com>"), not an address
    // the GC typed wrong. Reporting it as skipped reads like we dropped a sub.
    if (!addr.includes('@') && !addr.includes('.')) continue;
    take(addr, '', part);
  }

  return { recipients, rejected };
}

/** Mirrors `bid_package_invites.status`. 'sent' is the row's default; the
 *  submit RPC is the only thing that writes 'submitted'. */
export type BidInviteStatus = 'sent' | 'submitted';

export interface BidInviteRecord {
  id: string;
  packageId: string;
  projectId: string;
  subName: string | null;
  subEmail: string;
  subcontractorId: string | null;
  inviteToken: string;
  status: BidInviteStatus | string;
  expiresAt: string | null;
  respondedAt: string | null;
  bidId: string | null;
  createdAt: string | null;
}

/** What the buyout screen shows against each invited sub. */
export type BidInviteState = 'responded' | 'awaiting' | 'expired';

export function inviteState(inv: Pick<BidInviteRecord, 'respondedAt' | 'expiresAt'>, nowMs: number): BidInviteState {
  if (inv.respondedAt) return 'responded';
  if (inv.expiresAt) {
    const t = Date.parse(inv.expiresAt);
    // An unparseable expiry is treated as "still open" rather than "expired":
    // telling a GC his live invite lapsed is the more damaging of the two
    // wrong answers, because he re-sends and the sub gets two links.
    if (Number.isFinite(t) && t <= nowMs) return 'expired';
  }
  return 'awaiting';
}

export function inviteStateLabel(state: BidInviteState): string {
  if (state === 'responded') return 'Bid received';
  if (state === 'expired') return 'Link expired';
  return 'No response yet';
}

/**
 * The counts behind the coverage line. `awaiting` is what makes "send the RFQ
 * to more subs" honest — three bids in hand and two invites outstanding is a
 * different decision from three bids and nothing outstanding.
 */
export function inviteCoverage(
  invites: Pick<BidInviteRecord, 'respondedAt' | 'expiresAt'>[],
  nowMs: number,
): { invited: number; responded: number; awaiting: number; expired: number } {
  let responded = 0, awaiting = 0, expired = 0;
  for (const inv of invites) {
    const s = inviteState(inv, nowMs);
    if (s === 'responded') responded++;
    else if (s === 'expired') expired++;
    else awaiting++;
  }
  return { invited: invites.length, responded, awaiting, expired };
}

/**
 * The addresses that already hold a LIVE link on this package — invited, not
 * expired, not answered.
 *
 * Re-sending to one of these is the accidental case (the GC re-opens the sheet
 * and pastes his list again): it mints a SECOND token for the same sub, and
 * `bid_invite_submit` blocks a second submit per INVITE, not per bidder — so
 * that sub can file two bids and the matrix shows one company as two competing
 * bidders. An expired or already-answered invite is deliberate re-invitation
 * and is left alone.
 */
export function liveInviteEmails(
  invites: Pick<BidInviteRecord, 'respondedAt' | 'expiresAt' | 'subEmail'>[],
  nowMs: number,
): Set<string> {
  const out = new Set<string>();
  for (const inv of invites) {
    if (inviteState(inv, nowMs) !== 'awaiting') continue;
    const e = (inv.subEmail || '').trim().toLowerCase();
    if (e) out.add(e);
  }
  return out;
}

/** Split what the GC typed into the ones to send and the ones already holding a
 *  live link, so the screen can name the second group rather than quietly
 *  minting them a duplicate token. */
export function splitAlreadyInvited(
  recipients: InviteRecipient[],
  invites: Pick<BidInviteRecord, 'respondedAt' | 'expiresAt' | 'subEmail'>[],
  nowMs: number,
): { fresh: InviteRecipient[]; alreadyLive: string[] } {
  const live = liveInviteEmails(invites, nowMs);
  const fresh: InviteRecipient[] = [];
  const alreadyLive: string[] = [];
  for (const r of recipients) {
    if (live.has(r.email.trim().toLowerCase())) alreadyLive.push(r.email);
    else fresh.push(r);
  }
  return { fresh, alreadyLive };
}
