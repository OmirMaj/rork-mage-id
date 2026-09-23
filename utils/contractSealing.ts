// contractSealing.ts — orchestrate the seal-document flow on the GC's
// device. Render contract → upload to secure-contracts → client SHA-256
// → invoke the seal-document edge fn which re-hashes server-side and
// writes signed_pdf_url + document_hash to project_contracts. Returns
// the same fields for the caller to merge into local state.
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectContract, Project, CompanyBranding } from '@/types';
import { generateContractPDFUri } from './pdfGenerator';
import { edgeFunctionError } from './edgeError';

export interface SealContractResult {
  signedPdfUrl: string;
  documentHash: string;
  sealedAt: string;
}

export class SealAlreadyExistsError extends Error {
  constructor(message = 'This contract has already been sealed.') {
    super(message);
    this.name = 'SealAlreadyExistsError';
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  // No new dep. atob is available in Hermes/JSC; if absent (unusual),
  // we fall through to an empty array which the server-side hash-verify
  // will reject — surfacing the issue rather than corrupting state.
  const bin = (globalThis as { atob?: (s: string) => string }).atob?.(b64) ?? '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

export async function sealSignedContract(input: {
  contract: ProjectContract;
  project: Project;
  branding: CompanyBranding;
  supabase: SupabaseClient;
  userId: string;
}): Promise<SealContractResult> {
  const { contract, project, branding, supabase, userId } = input;

  // Guard: only seal a fully-signed contract that hasn't been sealed yet.
  if (contract.status !== 'signed') throw new Error('Contract is not in signed status.');
  if (!contract.gcSignature || !contract.homeownerSignature) {
    throw new Error('Both GC and homeowner signatures are required to seal.');
  }
  if (contract.signedPdfUrl) throw new SealAlreadyExistsError();

  // 1. Render the PDF on-device.
  const fileUri = await generateContractPDFUri(contract, project, branding);
  if (!fileUri) throw new Error('Web sealing is not supported. Use the mobile app to seal a contract.');

  // 2. Read bytes (base64) + compute client SHA-256.
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  const clientHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
    { encoding: Crypto.CryptoEncoding.HEX },
  );

  // 3. Upload to private bucket. upsert:false → second seal of the same
  //    contract id is rejected by Storage (effective immutability).
  const storagePath = `${userId}/${contract.id}.pdf`;
  const bytes = base64ToUint8Array(base64);
  const { error: upErr } = await supabase
    .storage
    .from('secure-contracts')
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });
  if (upErr) {
    const msg = (upErr.message ?? '').toLowerCase();
    if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('conflict')) {
      throw new SealAlreadyExistsError();
    }
    throw new Error(`Failed to upload sealed PDF: ${upErr.message}`);
  }

  // 4. Server-side hash-verify + DB write.
  const { data, error } = await supabase.functions.invoke('seal-document', {
    body: { contract_id: contract.id, storage_path: storagePath, client_hash: clientHash },
  });
  if (error) {
    // CONTRACT 26: the function's own sentence (hash mismatch, not signed…).
    const e = await edgeFunctionError(error, 'seal-document failed');
    throw new Error(`seal-document failed: ${e.message}`);
  }
  const payload = data as { signed_pdf_url?: string; document_hash?: string; sealed_at?: string } | null;
  if (!payload || !payload.signed_pdf_url || !payload.document_hash || !payload.sealed_at) {
    throw new Error('seal-document returned an incomplete result.');
  }
  return {
    signedPdfUrl: payload.signed_pdf_url,
    documentHash: payload.document_hash,
    sealedAt: payload.sealed_at,
  };
}

/** What the web tap says when the browser refuses the download tab. Starts
 *  with the same sentence as PRINT_WINDOW_BLOCKED_MESSAGE, so any caller that
 *  passes errors through pdfFailureMessage shows it; names THIS button. */
export const SEALED_PDF_WINDOW_BLOCKED_MESSAGE =
  'Your browser blocked the PDF window. Allow pop-ups for app.mageid.app and tap Download sealed PDF again.';
export const SEALED_PDF_DOWNLOAD_FAILED_MESSAGE =
  "Couldn't download the sealed PDF - check your signal and try again.";

/** Signed-URL life. 60 s was shorter than a slow jobsite download; the path is
 *  owner-only and the URL is never stored, so minutes cost nothing. */
export const SEALED_PDF_URL_TTL_SECONDS = 300;

/** Cache file name for the downloaded copy. The contract id is a local id
 *  that can carry any character; a path separator in it would write outside
 *  the cache directory or fail the download. */
export function sealedPdfCacheFileName(contractId: string): string {
  return `contract-${contractId.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
}

export async function downloadSealedContractPdf(input: {
  contract: ProjectContract;
  userId: string;
  supabase: SupabaseClient;
}): Promise<void> {
  const { contract, userId, supabase } = input;
  if (!contract.signedPdfUrl) throw new Error('No sealed PDF on file for this contract.');

  // signed_pdf_url is the storage path (set by the edge fn). Mint a
  // short-lived signed URL, then hand the FILE to the user.
  const storagePath = contract.signedPdfUrl.startsWith(`${userId}/`)
    ? contract.signedPdfUrl
    : `${userId}/${contract.id}.pdf`;

  // WEB: open the tab NOW, before the first await (audit 2026-09-23 #56).
  // The createSignedUrl round-trip below consumes the tap's transient user
  // activation, so a window.open after it is an unprompted pop-up that Safari
  // swallows — and with 'noopener' window.open returns null whether it opened
  // or not, so the old code could not tell and nothing was ever said. The tab
  // is opened blank WITHOUT noopener (so a block is detectable), then cut
  // loose from this page (opener = null) before it is pointed at storage.
  // expo-sharing is not used on web: its isAvailableAsync is just
  // !!navigator.share, false on desktop Chrome and Firefox.
  if (Platform.OS === 'web') {
    const w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (!w) throw new Error(SEALED_PDF_WINDOW_BLOCKED_MESSAGE);
    try {
      const { data, error } = await supabase
        .storage
        .from('secure-contracts')
        .createSignedUrl(storagePath, SEALED_PDF_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) {
        throw new Error(`Failed to create a download link: ${error?.message ?? 'unknown error'}`);
      }
      w.opener = null;
      w.location.href = data.signedUrl;
    } catch (e) {
      // Never leave him staring at a blank tab that will never load.
      try { w.close(); } catch { /* already gone */ }
      throw e;
    }
    return;
  }

  // NATIVE: expo-sharing only shares a readable LOCAL file. Handing it the
  // https signed URL failed every time on iPhone with "You don't have access
  // to the provided file" (SharingModule.swift checks isReadableFile). So the
  // PDF is downloaded into the cache first and the local copy is shared. An
  // unavailable share sheet is said out loud — it used to return silently,
  // which read as a download that did nothing.
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device, so the sealed PDF can't be saved from here.");
  }
  const { data, error } = await supabase
    .storage
    .from('secure-contracts')
    .createSignedUrl(storagePath, SEALED_PDF_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create a download link: ${error?.message ?? 'unknown error'}`);
  }
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!dir) throw new Error(SEALED_PDF_DOWNLOAD_FAILED_MESSAGE);
  let localUri: string;
  try {
    const dl = await FileSystem.downloadAsync(data.signedUrl, `${dir}${sealedPdfCacheFileName(contract.id)}`);
    // downloadAsync RESOLVES on a 4xx/5xx and writes the error body to disk;
    // sharing that would hand him an XML error page named .pdf.
    if (dl.status !== 200) throw new Error(`HTTP ${dl.status}`);
    localUri = dl.uri;
  } catch (e) {
    console.warn('[contractSealing] sealed PDF download failed:', e);
    throw new Error(SEALED_PDF_DOWNLOAD_FAILED_MESSAGE);
  }
  await Sharing.shareAsync(localUri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Signed contract PDF',
    UTI: 'com.adobe.pdf',
  });
}
