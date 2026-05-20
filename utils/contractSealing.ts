// contractSealing.ts — orchestrate the seal-document flow on the GC's
// device. Render contract → upload to secure-contracts → client SHA-256
// → invoke the seal-document edge fn which re-hashes server-side and
// writes signed_pdf_url + document_hash to project_contracts. Returns
// the same fields for the caller to merge into local state.
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectContract, Project, CompanyBranding } from '@/types';
import { generateContractPDFUri } from './pdfGenerator';

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
  if (error) throw new Error(`seal-document failed: ${error.message}`);
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

export async function downloadSealedContractPdf(input: {
  contract: ProjectContract;
  userId: string;
  supabase: SupabaseClient;
}): Promise<void> {
  const { contract, userId, supabase } = input;
  if (!contract.signedPdfUrl) throw new Error('No sealed PDF on file for this contract.');

  // signed_pdf_url is the storage path (set by the edge fn). Mint a
  // short-lived signed URL and share.
  const storagePath = contract.signedPdfUrl.startsWith(`${userId}/`)
    ? contract.signedPdfUrl
    : `${userId}/${contract.id}.pdf`;
  const { data, error } = await supabase
    .storage
    .from('secure-contracts')
    .createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create a download link: ${error?.message ?? 'unknown error'}`);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(data.signedUrl, {
      mimeType: 'application/pdf',
      dialogTitle: 'Signed contract PDF',
      UTI: 'com.adobe.pdf',
    });
  }
}
