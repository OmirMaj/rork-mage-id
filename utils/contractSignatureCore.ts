// contractSignatureCore — recording a homeowner signature that was given
// OUTSIDE the portal (#67, wave 4): at the kitchen table on the GC's phone
// ("in person") or on a printed copy ("on paper").
//
// WHY: portal_sign_contract was the only writer of homeowner_signature and
// status 'signed'. A homeowner who signed a printed copy — or a job with the
// portal off — left the contract at 'Sent' forever, so the deposit milestone
// never became billable and the workflow dead-ended.
//
// Rules this file enforces (executed by scripts/validate-w4-contract-portal-setup-*.ts):
//  · The record says HOW it was signed (method 'in_person' | 'paper'), so the
//    PDF, the portal and the seal never present it as a portal e-signature.
//  · Paper needs a photo of the signed page (evidencePath) and a calendar day
//    that is not in the future — an unproven claim is not shown as fact.
//  · The write flips the row ONLY while it is still 'sent' with no homeowner
//    signature (re-read + conditional update), so a portal signature that
//    landed meanwhile is never overwritten.
//  · No signal refuses with a reason: this write is not queued (the row is a
//    legal record whose state must be read before it is changed).
//
// Pure: no react-native, no @/lib/supabase. The real IO lives in
// utils/contractEngine.ts recordHomeownerSignature().

import type { ContractSignature, ContractStatus } from '@/types';
import { isTransportError } from '@/utils/networkErrors';

export type RecordedSignatureMethod = 'in_person' | 'paper';

export interface RecordSignatureDraft {
  method: RecordedSignatureMethod;
  /** The homeowner's typed legal name. */
  name: string;
  /** In person: the SVG paths from the pad the homeowner signed. */
  signaturePaths?: string[];
  /** Paper: the calendar day (YYYY-MM-DD) written on the signed page. */
  signedDay?: string;
  /** Paper: a photo of the signed page has been taken / picked. */
  hasPagePhoto?: boolean;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Why this draft cannot be recorded yet, or null when it can. `todayDay` is
 *  the device's local calendar day (utils/calendarDate). */
export function recordSignatureBlockReason(d: RecordSignatureDraft, todayDay: string): string | null {
  if (d.name.trim().length < 2) return "Type the homeowner's full legal name.";
  if (d.method === 'in_person') {
    if (!d.signaturePaths || d.signaturePaths.length === 0) return 'Hand the phone to the homeowner to sign in the box.';
    return null;
  }
  if (!d.signedDay || !DAY_RE.test(d.signedDay)) return 'Pick the day written on the signed page.';
  if (d.signedDay > todayDay) return 'The signing day cannot be in the future.';
  if (!d.hasPagePhoto) return 'Add a photo of the signed page — it is the proof this signature was given.';
  return null;
}

/** The homeowner_signature jsonb for a recorded signature. A paper signature
 *  is dated to its calendar day at noon UTC (the codebase's day-instant
 *  convention — never a day that shifts across time zones). */
export function buildRecordedHomeownerSignature(
  d: RecordSignatureDraft,
  opts: { nowIso: string; evidencePath?: string },
): ContractSignature {
  const base: ContractSignature = {
    name: d.name.trim(),
    role: 'homeowner',
    method: d.method,
    signedAt: d.method === 'paper' && d.signedDay ? `${d.signedDay}T12:00:00.000Z` : opts.nowIso,
  };
  if (d.method === 'in_person') return { ...base, signaturePaths: d.signaturePaths ?? [] };
  return { ...base, evidencePath: opts.evidencePath };
}

export type RecordSignatureOutcome =
  | { kind: 'signed' }
  | { kind: 'not_sent'; status: ContractStatus | null; homeownerSigned: boolean }
  | { kind: 'offline' }
  | { kind: 'failed'; error: string };

export interface RecordSignatureIO {
  /** The live row's status. null = not found. Throws on a transport error. */
  readState(contractId: string): Promise<{ status: ContractStatus; homeownerSigned: boolean } | null>;
  /** UPDATE … WHERE id AND status='sent' AND homeowner_signature IS NULL;
   *  resolves the number of rows written. Throws on error. */
  flipIfStillSent(contractId: string, patch: { homeowner_signature: ContractSignature; status: 'signed'; signed_at: string }): Promise<number>;
}

/** Re-read, then flip only if the row is still 'sent' and unsigned. */
export async function recordHomeownerSignatureWith(
  io: RecordSignatureIO,
  contractId: string,
  signature: ContractSignature,
): Promise<RecordSignatureOutcome> {
  try {
    const state = await io.readState(contractId);
    if (!state || state.status !== 'sent' || state.homeownerSigned) {
      return { kind: 'not_sent', status: state?.status ?? null, homeownerSigned: !!state?.homeownerSigned };
    }
    const n = await io.flipIfStillSent(contractId, {
      homeowner_signature: signature,
      status: 'signed',
      signed_at: signature.signedAt,
    });
    if (n === 1) return { kind: 'signed' };
    // Lost the race: re-read to say what happened instead.
    const after = await io.readState(contractId);
    return { kind: 'not_sent', status: after?.status ?? null, homeownerSigned: !!after?.homeownerSigned };
  } catch (err) {
    if (isTransportError(err)) return { kind: 'offline' };
    return { kind: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/** The alert for a refused / failed record. null for 'signed'. */
export function recordSignatureOutcomeMessage(o: RecordSignatureOutcome): { title: string; body: string } | null {
  switch (o.kind) {
    case 'signed': return null;
    case 'offline': return {
      title: 'No connection',
      body: 'Nothing was recorded — the contract is still Sent. Try again when you have signal; keep the signed page.',
    };
    case 'not_sent': return o.homeownerSigned || o.status === 'signed'
      ? { title: 'Already signed', body: 'The homeowner has already signed this contract (in their portal or on another device). Nothing was changed.' }
      : { title: 'Not recorded', body: `This contract is ${o.status ?? 'no longer on file'}, not Sent, so a homeowner signature can't be recorded on it.` };
    case 'failed': return { title: 'Not recorded', body: `The signature was not saved (${o.error}). The contract is still Sent.` };
  }
}

/** How the signature block labels a homeowner signature. */
export function homeownerSignatureMethodLabel(sig: Pick<ContractSignature, 'method'> | undefined): string | null {
  if (!sig?.method) return null;
  if (sig.method === 'in_person') return 'Signed in person on the contractor\'s device';
  if (sig.method === 'paper') return 'Signed on paper — photo of the signed page on file';
  return 'Signed in the client portal';
}
