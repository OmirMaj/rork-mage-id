// auth-magic-link/copy.ts — the pure decisions behind the two emails this
// function sends. No Deno globals, no network: index.ts imports it, and
// scripts/validate-w5-crew-magic-link.ts exercises it under bun.
//
// Two purposes (#72, 2026-09-23 audit):
//   • 'sign_in' — the default, a person asking for his own sign-in link.
//   • 'crew_claim' — a GC inviting a worker to claim the crew profile he made.
// The claim invite used to go out as the sign-in email: "Welcome back to MAGE
// ID", no contractor named, no reason given, and a footer promising "no
// account will be created" — sent AFTER generateLink('magiclink') had already
// created the account. A tradesperson who never signed up read it as phishing.

export type MagicLinkPurpose = 'sign_in' | 'crew_claim';

/** The request's purpose; null for anything unknown (the caller answers 400,
 *  never silently falls back to a different email). */
export function parsePurpose(raw: unknown): MagicLinkPurpose | null {
  if (raw === undefined || raw === null || raw === '' || raw === 'sign_in') return 'sign_in';
  if (raw === 'crew_claim') return 'crew_claim';
  return null;
}

/** Same shape as utils/crew/claimToken.isValidClaimTokenFormat and
 *  claim-crew's copy — keep the three in sync. */
export function isValidClaimTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && /^crew_[0-9a-f-]{20,}$/i.test(token);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/** Who the claim email says it is from. Read from the CALLER's profile row
 *  (never the request body — this endpoint is open, and "<Any Company> added
 *  you" from a body field would be a spoofing tool). `fromCompanyName` is set
 *  only when the profile actually names someone; otherwise the mail goes out
 *  as plain MAGE ID and the copy says "Your contractor". */
export function inviterIdentity(profile: { company_name?: string | null; contact_name?: string | null } | null | undefined): {
  display: string;
  fromCompanyName?: string;
} {
  const company = (profile?.company_name ?? '').trim();
  const contact = (profile?.contact_name ?? '').trim();
  const named = company || contact;
  return named ? { display: named, fromCompanyName: named } : { display: 'Your contractor' };
}

/** The crew row the invite is for, as the server read it. */
export interface ClaimRow {
  id: string;
  email: string | null;
  claim_token: string | null;
  claimed_by_user_id: string | null;
}

export type ClaimCheck =
  | { ok: true; token: string; mint: boolean }
  | { ok: false; status: number; code: string; error: string };

/** May this caller send a claim invite for this row to this address?
 *  `row` is the crew_members row with id = memberId AND user_id = caller (null
 *  when there is none — someone else's crew, or no such member). The token
 *  mailed is the one the SERVER holds: with the stale-copy freeze
 *  (20260923160000) a device that never saw the saved token can't overwrite
 *  it, so mailing the device's copy would send a link that can never redeem.
 *  When the row has no token yet (the mint write is still in flight from the
 *  GC's phone), the request's well-formed token is minted server-side
 *  (`mint: true`); the phone's own write then lands as a no-op. */
export function checkClaimInvite(row: ClaimRow | null, email: string, requestToken: unknown): ClaimCheck {
  if (!row) return { ok: false, status: 404, code: 'not_your_crew', error: "That crew member isn't on your roster." };
  if (row.claimed_by_user_id) {
    return { ok: false, status: 409, code: 'already_claimed', error: 'This crew member has already claimed the profile.' };
  }
  const saved = (row.email ?? '').trim().toLowerCase();
  if (!saved || saved !== email) {
    return {
      ok: false, status: 409, code: 'email_mismatch',
      error: "That email isn't saved on this crew member yet. Save his details, wait a moment, and send the invite again.",
    };
  }
  if (row.claim_token && isValidClaimTokenFormat(row.claim_token)) return { ok: true, token: row.claim_token, mint: false };
  if (isValidClaimTokenFormat(requestToken)) return { ok: true, token: requestToken, mint: true };
  return { ok: false, status: 400, code: 'no_invite_token', error: 'Could not start the invite. Try again.' };
}

/** The claim redirect with the server's token. Only a /claim-crew path over
 *  https (http only for localhost dev) is accepted; GoTrue still checks the
 *  origin against the project's redirect allow-list. Null when unusable. */
export function claimRedirect(redirectTo: unknown, token: string): string | null {
  if (typeof redirectTo !== 'string' || !redirectTo) return null;
  let u: URL;
  try { u = new URL(redirectTo); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  if (u.pathname.replace(/\/+$/, '') !== '/claim-crew') return null;
  u.hash = '';
  u.search = '';
  u.searchParams.set('token', token);
  return u.toString();
}

export interface EmailCopy {
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Plain text; index.ts escapes it into the footer paragraph. */
  footer: string;
  ctaLabel: string;
}

/** The sign-in email. Neutral: the same mail goes to a returning user and to
 *  an address that has never signed in (generateLink creates that account),
 *  so it can say neither "Welcome back" nor "no account will be created". */
export function signInEmailCopy(email: string): EmailCopy {
  return {
    subject: 'Your MAGE ID sign-in link',
    preheader: 'Your one-tap sign-in link for MAGE ID — expires in 60 minutes.',
    eyebrow: 'One-tap sign-in',
    title: 'Your MAGE ID sign-in link',
    subtitle: `Tap the button below to continue as ${email}. The link is good for one tap and expires in 60 minutes.`,
    footer: `You're receiving this because someone entered ${email} on MAGE ID. If you didn't expect it, you can ignore this email.`,
    ctaLabel: 'Sign in to MAGE ID',
  };
}

/** The crew-claim email: who added him, what claiming gives him, what the
 *  button does. Nothing about hiring visibility — the marketplace isn't live
 *  (HIRE_ENABLED is false, #170). */
export function crewClaimEmailCopy(inviter: string, email: string): EmailCopy {
  return {
    subject: `${inviter} added you to their crew on MAGE ID`,
    preheader: `${inviter} added you to their crew on MAGE ID. Claim your profile to keep your own details up to date.`,
    eyebrow: 'Claim your profile',
    title: 'Claim your crew profile',
    subtitle: `${inviter} added you to their crew on MAGE ID. Claim the profile to keep your own phone, email and trades on it up to date yourself.`,
    footer: `You're receiving this because ${inviter} added ${email} to their crew on MAGE ID. The button signs you in with this email; it works once and expires in 60 minutes — if it has expired, open it anyway and the page lets you get a fresh one. If you don't know ${inviter}, you can ignore this email.`,
    ctaLabel: 'Claim my profile',
  };
}
