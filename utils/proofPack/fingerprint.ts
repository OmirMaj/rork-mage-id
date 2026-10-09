// utils/proofPack/fingerprint.ts — the package's fingerprint and its check code.
//
// The fingerprint is SHA-256 over ONE canonical text of the whole package
// object (utils/proofPack/core ProofPack): keys sorted at every depth, no
// whitespace. The canonical writer is the one the sealed punch already uses
// (supabase/functions/_shared/punchSealManifest canonicalJson), so the app has
// one canonical form, not two.
//
// What the fingerprint covers: every figure, date, label, count and id in the
// package, the left-out counts and the open items. What it does NOT cover: the
// photo FILES (only each photo's record), the language the document is printed
// in, and the layout of the PDF. The document says so in plain words.
//
// The check code is the first 50 bits of the fingerprint in Crockford base 32,
// printed as two groups of five. It is a short name for the fingerprint, easy
// to read out over the phone. It is not a secret and proves nothing alone.
//
// Pure: the SHA-256 function is handed in (expo-crypto on a device, node:crypto
// in the validator), so the same text gives the same fingerprint everywhere.
import { canonicalJson } from '@/supabase/functions/_shared/punchSealManifest';
import type { ProofPack } from '@/utils/proofPack/core';

export type Sha256Hex = (text: string) => Promise<string>;

export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The one text the fingerprint is taken over. */
export function proofPackCanonicalText(pack: ProofPack): string {
  return canonicalJson(pack);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** "ABCDE-FGHJK" from a 64-character hex fingerprint, or '' when it is not one. */
export function checkCodeOf(hashHex: string): string {
  const h = (hashHex ?? '').toLowerCase();
  if (!SHA256_HEX.test(h)) return '';
  // 50 bits = 12.5 hex characters: take 13 and drop the last 2 bits.
  let bits = '';
  for (const ch of h.slice(0, 13)) bits += parseInt(ch, 16).toString(2).padStart(4, '0');
  bits = bits.slice(0, 50);
  let out = '';
  for (let i = 0; i < 50; i += 5) out += CROCKFORD[parseInt(bits.slice(i, i + 5), 2)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export interface ProofFingerprint {
  hash: string;
  code: string;
}

export async function proofPackFingerprint(pack: ProofPack, sha256Hex: Sha256Hex): Promise<ProofFingerprint> {
  const hash = (await sha256Hex(proofPackCanonicalText(pack))).toLowerCase();
  if (!SHA256_HEX.test(hash)) throw new Error('proofPackFingerprint: the hash function did not return SHA-256 hex');
  return { hash, code: checkCodeOf(hash) };
}

/**
 * What the app can say when a package is opened again.
 *  match        the copy on this device gives the fingerprint the server has on file
 *  changed      it gives a different one: the copy is not what was put on file
 *  not_on_file  the server has no fingerprint for this package
 *  not_checked  the server could not be asked (no signal, or the answer failed)
 */
export type ProofCheck = 'match' | 'changed' | 'not_on_file' | 'not_checked';

/**
 * @param recomputed the fingerprint worked out NOW from the saved copy
 * @param onFile     the server's stored fingerprint; null = asked and none; undefined = could not ask
 */
export function compareFingerprint(recomputed: string, onFile: string | null | undefined): ProofCheck {
  if (onFile === undefined) return 'not_checked';
  if (onFile === null || onFile === '') return 'not_on_file';
  return recomputed.toLowerCase() === onFile.toLowerCase() ? 'match' : 'changed';
}

/** The same four answers for a FILE's bytes against the file fingerprint on record. */
export function compareFileFingerprint(fileHash: string, onFile: string | null | undefined): ProofCheck {
  return compareFingerprint(fileHash, onFile);
}
