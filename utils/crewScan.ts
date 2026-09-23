import { supabase } from '@/lib/supabase';
import type { IdDocumentType } from '@/types';
import { shareLinkBase } from '@/utils/webAppOrigin';
import { edgeFunctionError } from '@/utils/edgeError';

export interface IdScanResult {
  fullName: string;
  idType: IdDocumentType;
  idNumberFull: string;
  expiry: string;
  issuer: string;
}
export interface CertScanResult {
  certType: string;
  certNumber: string;
  issuer: string;
  issuedDate: string;
  expiresDate: string;
}

/** Call scan-credential with an inline base64 image (from expo-image-picker
 *  base64:true). Throws with a user-facing message on failure.
 *
 *  A non-2xx arrives from supabase-js as "Edge Function returned a non-2xx
 *  status code"; the server's own sentence ("Monthly credential-scan limit
 *  reached (…)") and its `code` hang off error.context. edgeFunctionError
 *  reads them (CONTRACT 26, #124), so the screen can show that sentence and
 *  route monthly_cap_reached / tier_required to the plans page instead of
 *  offering a retry that will be refused again. */
export async function scanGovernmentId(imageBase64: string, mimeType = 'image/jpeg'): Promise<IdScanResult> {
  const { data, error } = await supabase.functions.invoke('scan-credential', {
    body: { kind: 'government_id', imageBase64, mimeType },
  });
  if (error) throw await edgeFunctionError(error, 'Scan failed');
  if (!data?.success) throw new Error(data?.error || 'Scan failed');
  return data.fields as IdScanResult;
}

export async function scanCertification(imageBase64: string, mimeType = 'image/jpeg'): Promise<CertScanResult> {
  const { data, error } = await supabase.functions.invoke('scan-credential', {
    body: { kind: 'certification', imageBase64, mimeType },
  });
  if (error) throw await edgeFunctionError(error, 'Scan failed');
  if (!data?.success) throw new Error(data?.error || 'Scan failed');
  return data.fields as CertScanResult;
}

/** Send the crew-claim invite so a worker can claim his CrewMember.
 *  The redirectTo carries the claim token; app/claim-crew.tsx redeems it.
 *
 *  The link is opened on the WORKER's device, not the GC's, and he may read
 *  the email on a laptop or on a phone that does not have MAGE ID yet. It was
 *  `mageid://claim-crew?…`, which opens only where the binary is installed —
 *  a dead link for exactly the person being invited. claim-crew is a public
 *  Expo route (app/_layout.tsx) and supabase-js picks the session out of the
 *  URL on web (lib/supabase.ts detectSessionInUrl), so the https route works
 *  anywhere. Always the production app host: a runtime origin is the GC's,
 *  and a dev server on his laptop is no place to send a worker.
 *
 *  purpose 'crew_claim' (#72): the generic sign-in mail read "Welcome back to
 *  MAGE ID … no account will be created" — no contractor, no reason, and a
 *  false promise. auth-magic-link now sends a claim email in the GC's company
 *  name. It reads that name from the CALLER's profile (never this body), and
 *  checks the email and member belong to a crew row the caller owns and that
 *  is still unclaimed; memberId + claimToken let it use the token the SERVER
 *  holds (a stale copy of the roster can't mail a token that was never saved).
 *  Resolves the company name the email was sent under, so the GC's
 *  confirmation can say who it came from. */
export async function sendClaimInvite(
  email: string,
  claimToken: string,
  memberId: string,
): Promise<{ companyName: string | null }> {
  const redirectTo = claimRedirectUrl(claimToken);
  const { data, error } = await supabase.functions.invoke('auth-magic-link', {
    body: { email, redirectTo, purpose: 'crew_claim', memberId, claimToken },
  });
  if (error) throw await edgeFunctionError(error, 'Could not send the invite');
  const companyName = typeof data?.companyName === 'string' && data.companyName.trim() ? data.companyName.trim() : null;
  return { companyName };
}

/** The worker's claim link — the one address both the GC's invite and the
 *  worker's own "email me a new link" use. */
export function claimRedirectUrl(claimToken: string): string {
  return `${shareLinkBase(null)}/claim-crew?token=${encodeURIComponent(claimToken)}`;
}

/** The same claim address as an in-app path (the claim route plus its
 *  token query, no host), for the post-login replay (utils/pendingDeepLink).
 *  A redirect target, not a door into the screen. Derived from
 *  claimRedirectUrl so the invite link and the replay can never disagree. */
export function claimAppPath(claimToken: string): string {
  return claimRedirectUrl(claimToken).replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
}

/** The worker asks for a fresh sign-in link from the claim page (#73) after
 *  the first one expired (60 min) or was used. The claim token itself is
 *  still unspent, so a plain sign-in link back to the same claim URL is all he
 *  needs — no GC involvement, and no contractor-branded email (the default
 *  sign-in purpose; he is asking for his own link). */
export async function requestFreshClaimLink(email: string, claimToken: string): Promise<void> {
  const { error } = await supabase.functions.invoke('auth-magic-link', {
    body: { email: email.trim(), redirectTo: claimRedirectUrl(claimToken) },
  });
  if (error) throw await edgeFunctionError(error, "Couldn't send a new link");
}

/** Redeem a claim token as the currently signed-in worker. The claiming worker
 *  is a different auth user than the owning GC, so the unclaimed row is invisible
 *  + un-writable to them under crew_members RLS — redemption MUST go through the
 *  service-role `claim-crew` edge function (never a client-side context mutation,
 *  which RLS silently blocks). Resolves the claimed memberId on success.
 *
 *  Throws an Error carrying claim-crew's `code` (#73) — invalid_token,
 *  already_claimed, unauthenticated — or '' / http_5xx when the request never
 *  got a verdict. A dropped signal used to read "This invite link is invalid
 *  or already used" although the link was fine; classifyClaimFailure tells
 *  the two apart. */
export async function redeemCrewClaim(claimToken: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('claim-crew', {
    body: { token: claimToken },
  });
  if (error) throw await edgeFunctionError(error, "Couldn't reach MAGE ID");
  if (!data?.success) {
    const code = typeof data?.code === 'string' ? data.code : 'invalid_token';
    throw Object.assign(new Error(data?.error || 'This invite link is invalid or already used.'), { code });
  }
  return data.memberId as string;
}

// ── Claim-link helpers (pure) ────────────────────────────────────────────────

/** What claim-crew's refusal means for the worker (#73). */
export type ClaimFailure = 'retry' | 'already_claimed' | 'invalid' | 'sign_in';

/** Map an error code from redeemCrewClaim to what the screen says.
 *  - '' (nothing reached the server), http_5xx, or a 5xx body with no code
 *    → 'retry': the invite is still good, only the request failed.
 *  - unauthenticated / http_401 → 'sign_in' (the session didn't take).
 *  - already_claimed → another account holds this profile.
 *  - anything else (invalid_token, http_4xx) → the link is invalid or spent. */
export function classifyClaimFailure(code: string): ClaimFailure {
  const c = (code ?? '').trim();
  if (c === '' || /^http_5\d\d$/.test(c)) return 'retry';
  if (c === 'unauthenticated' || c === 'http_401') return 'sign_in';
  if (c === 'already_claimed') return 'already_claimed';
  return 'invalid';
}

/** The auth error GoTrue put on a magic-link redirect, or null.
 *  An expired or already-used link lands on
 *  /claim-crew?token=…#error=access_denied&error_code=otp_expired&error_description=…
 *  (GoTrue can use the query string instead of the fragment), and
 *  MagicLinkHandler only logs it — so the screen reads it itself. Both halves
 *  of the URL are searched; the fragment wins. */
export function parseAuthLinkError(url: string | null | undefined): { code: string; description: string } | null {
  if (!url) return null;
  const hashIdx = url.indexOf('#');
  const qIdx = url.indexOf('?');
  const parts: string[] = [];
  if (hashIdx >= 0) parts.push(url.slice(hashIdx + 1));
  if (qIdx >= 0) parts.push(url.slice(qIdx + 1, hashIdx > qIdx ? hashIdx : undefined));
  for (const part of parts) {
    let params: URLSearchParams;
    try { params = new URLSearchParams(part); } catch { continue; }
    const code = (params.get('error_code') ?? '').trim();
    const error = (params.get('error') ?? '').trim();
    const description = (params.get('error_description') ?? '').replace(/\+/g, ' ').trim();
    if (code || error || description) return { code: code || error || 'auth_error', description };
  }
  return null;
}
