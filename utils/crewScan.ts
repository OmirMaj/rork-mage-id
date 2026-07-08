import { supabase } from '@/lib/supabase';
import type { IdDocumentType } from '@/types';

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
 *  base64:true). Throws with a user-facing message on failure. */
export async function scanGovernmentId(imageBase64: string, mimeType = 'image/jpeg'): Promise<IdScanResult> {
  const { data, error } = await supabase.functions.invoke('scan-credential', {
    body: { kind: 'government_id', imageBase64, mimeType },
  });
  if (error) throw new Error(error.message || 'Scan failed');
  if (!data?.success) throw new Error(data?.error || 'Scan failed');
  return data.fields as IdScanResult;
}

export async function scanCertification(imageBase64: string, mimeType = 'image/jpeg'): Promise<CertScanResult> {
  const { data, error } = await supabase.functions.invoke('scan-credential', {
    body: { kind: 'certification', imageBase64, mimeType },
  });
  if (error) throw new Error(error.message || 'Scan failed');
  if (!data?.success) throw new Error(data?.error || 'Scan failed');
  return data.fields as CertScanResult;
}

/** Send a branded magic-link invite so a worker can claim their CrewMember.
 *  The redirectTo carries the claim token; app/claim-crew.tsx redeems it. */
export async function sendClaimInvite(email: string, claimToken: string): Promise<void> {
  const redirectTo = `rork-app://claim-crew?token=${encodeURIComponent(claimToken)}`;
  const { error } = await supabase.functions.invoke('auth-magic-link', {
    body: { email, redirectTo },
  });
  if (error) throw new Error(error.message || 'Could not send invite');
}

/** Redeem a claim token as the currently signed-in worker. The claiming worker
 *  is a different auth user than the owning GC, so the unclaimed row is invisible
 *  + un-writable to them under crew_members RLS — redemption MUST go through the
 *  service-role `claim-crew` edge function (never a client-side context mutation,
 *  which RLS silently blocks). Resolves the claimed memberId on success; throws a
 *  user-facing message on an invalid/spent token or transport failure. */
export async function redeemCrewClaim(claimToken: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('claim-crew', {
    body: { token: claimToken },
  });
  if (error) throw new Error(error.message || 'Could not claim your profile');
  if (!data?.success) throw new Error(data?.error || 'This invite link is invalid or already used.');
  return data.memberId as string;
}
