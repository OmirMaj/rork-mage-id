// utils/proofPack/store.ts — where a made package is kept, and the one thing that leaves the phone.
//
// TWO PLACES:
//   1. THIS DEVICE. The package's data (the exact object the fingerprint was
//      taken over) is kept in AsyncStorage under `mageid_proof_packs_<projectId>`
//      (an owned prefix: utils/localCacheKeys.ts sweeps it on sign-out). It is
//      what "open the package again" re-fingerprints. The newest
//      PROOF_PACKS_KEPT per project are kept.
//   2. THE SERVER. ONLY the fingerprint record: the SHA-256, the counts, the
//      pay document's id, one letter of the project name and the city
//      (supabase/migrations/20261009120000_proof_packs.sql). No amount, no name,
//      no address, no photo. The server sets the time and derives the check code.
//
// Nothing here calls a model, and nothing uploads the package or its PDF.
//
// Both server calls go through the online-only door (utils/offlineQueue
// supabaseRpcOnline): a fingerprint record needs a live answer and is never
// queued. Until the migration is applied the call fails, the caller gets
// `null`, and the document prints "No fingerprint is on file for this copy".
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { supabaseRpcOnline } from '@/utils/offlineQueue';
import type { ProofCoSignatureRecord, ProofPack } from '@/utils/proofPack/core';
import type { ProofDocLang } from '@/utils/proofPack/docCopy';
import {
  SHA256_HEX, compareFingerprint, proofPackFingerprint,
  type ProofCheck, type ProofFingerprint, type Sha256Hex,
} from '@/utils/proofPack/fingerprint';

export const PROOF_PACKS_KEY_PREFIX = 'mageid_proof_packs_';
export const PROOF_PACKS_KEPT = 12;

export function proofPacksKey(projectId: string): string {
  return `${PROOF_PACKS_KEY_PREFIX}${projectId}`;
}

/** SHA-256 of a text on the device (expo-crypto), lower-case hex. */
export const sha256HexOnDevice: Sha256Hex = async (text) =>
  (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: Crypto.CryptoEncoding.HEX })).toLowerCase();

export interface SavedProofPack {
  pack: ProofPack;
  lang: ProofDocLang;
  fingerprint: ProofFingerprint;
  /** proof_packs.id, or null when no record is on file. */
  serverId: string | null;
  /** proof_packs.created_at (the server's clock), or null. */
  serverCreatedAt: string | null;
  /** SHA-256 of the PDF file the phone made, when one was attached. */
  pdfHash: string | null;
}

export async function readSavedProofPacks(projectId: string): Promise<SavedProofPack[]> {
  try {
    const raw = await AsyncStorage.getItem(proofPacksKey(projectId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => x && x.pack && x.fingerprint && typeof x.fingerprint.hash === 'string') : [];
  } catch {
    return [];
  }
}

/** Newest first; one entry per fingerprint. Never throws (a full disk loses the copy, not the share). */
export async function saveProofPack(entry: SavedProofPack): Promise<boolean> {
  try {
    const prior = await readSavedProofPacks(entry.pack.project.id);
    const next = [entry, ...prior.filter((p) => p.fingerprint.hash !== entry.fingerprint.hash)].slice(0, PROOF_PACKS_KEPT);
    await AsyncStorage.setItem(proofPacksKey(entry.pack.project.id), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** The city out of a free-text location: the part before the last comma group, capped. '' when unsure. */
export function cityOfLocation(location: string): string {
  const parts = (location ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  // "123 Main St, Baltimore, MD 21201" gives Baltimore; "Baltimore, MD" gives Baltimore.
  const city = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  return /\d/.test(city) ? '' : city.slice(0, 80);
}

/** Exactly what the server is sent. One place, so a test can read every field. */
export function fingerprintRecordArgs(pack: ProofPack, fp: ProofFingerprint): Record<string, unknown> {
  return {
    p_project_id: pack.project.id,
    p_pay_kind: pack.pay.kind,
    p_pay_id: pack.pay.id,
    p_content_hash: fp.hash,
    p_item_count: pack.items.length,
    p_left_out_count: pack.leftOut.total,
    p_project_initial: (pack.project.name.trim()[0] ?? '').toUpperCase(),
    p_city: cityOfLocation(pack.project.location),
  };
}

export interface FiledFingerprint { id: string; createdAt: string; pdfHash: string | null }

/** Puts the fingerprint on file. null = it is NOT on file (offline, refused, or the table is not there yet). */
export async function fileFingerprint(pack: ProofPack, fp: ProofFingerprint): Promise<FiledFingerprint | null> {
  try {
    const res = await supabaseRpcOnline<{ id?: string; created_at?: string; content_hash?: string; pdf_hash?: string | null }>(
      'proof_pack_create_v1', fingerprintRecordArgs(pack, fp),
    );
    const d = res.status === 'synced' ? res.data : null;
    if (!d || typeof d.id !== 'string' || typeof d.created_at !== 'string' || d.content_hash !== fp.hash) return null;
    return { id: d.id, createdAt: d.created_at, pdfHash: typeof d.pdf_hash === 'string' ? d.pdf_hash : null };
  } catch {
    return null;
  }
}

/** Attaches the PDF file's fingerprint, once. Returns the hash now on file, or null when nothing is. */
export async function attachFileFingerprint(serverId: string, pdfHash: string): Promise<string | null> {
  if (!SHA256_HEX.test(pdfHash)) return null;
  try {
    const res = await supabaseRpcOnline<{ pdf_hash?: string | null }>('proof_pack_attach_pdf_v1', { p_id: serverId, p_pdf_hash: pdfHash });
    const h = res.status === 'synced' ? res.data?.pdf_hash : null;
    return typeof h === 'string' ? h : null;
  } catch {
    return null;
  }
}

export interface FingerprintOnFile { hash: string; createdAt: string; pdfHash: string | null }

/** Reads the record back. null = asked and none on file; undefined = could not ask. */
export async function readFingerprintOnFile(serverId: string | null): Promise<FingerprintOnFile | null | undefined> {
  if (!serverId) return null;
  try {
    const { data, error } = await supabase
      .from('proof_packs')
      .select('content_hash, created_at, pdf_hash')
      .eq('id', serverId)
      .maybeSingle();
    if (error) return undefined;
    if (!data) return null;
    const row = data as { content_hash?: string; created_at?: string; pdf_hash?: string | null };
    if (typeof row.content_hash !== 'string' || typeof row.created_at !== 'string') return undefined;
    return { hash: row.content_hash, createdAt: row.created_at, pdfHash: row.pdf_hash ?? null };
  } catch {
    return undefined;
  }
}

/**
 * The signature rows for a project's change orders, as the SERVER holds them
 * (change_order_approvals; created_at is the server's now()). Only the six
 * columns the package may carry are asked for: never the signer's email, the
 * browser string or the drawn signature itself. undefined = could not read.
 */
export async function readCoSignatureRecords(projectId: string): Promise<ProofCoSignatureRecord[] | undefined> {
  try {
    const { data, error } = await supabase
      .from('change_order_approvals')
      .select('change_order_id, decision, signer_name, created_at, document_hash, signature_hash')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) return undefined;
    const out: ProofCoSignatureRecord[] = [];
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      const decision = raw.decision === 'approved' ? 'approved' : raw.decision === 'declined' ? 'declined' : null;
      if (!decision || typeof raw.change_order_id !== 'string' || typeof raw.created_at !== 'string') continue;
      out.push({
        changeOrderId: raw.change_order_id,
        decision,
        signerName: typeof raw.signer_name === 'string' ? raw.signer_name.trim() : '',
        serverCreatedAt: raw.created_at,
        documentHash: typeof raw.document_hash === 'string' ? raw.document_hash : '',
        hasSignature: typeof raw.signature_hash === 'string' && raw.signature_hash.length > 0,
      });
    }
    return out;
  } catch {
    return undefined;
  }
}

export interface ProofReopenResult {
  check: ProofCheck;
  /** The fingerprint worked out now from the copy on this device. */
  recomputed: ProofFingerprint;
  onFile: FingerprintOnFile | null | undefined;
}

/** Open a saved package again: work the fingerprint out afresh and compare it with the server's. */
export async function recheckSavedProofPack(
  saved: SavedProofPack,
  deps: { sha256Hex?: Sha256Hex; read?: typeof readFingerprintOnFile } = {},
): Promise<ProofReopenResult> {
  const recomputed = await proofPackFingerprint(saved.pack, deps.sha256Hex ?? sha256HexOnDevice);
  const onFile = await (deps.read ?? readFingerprintOnFile)(saved.serverId);
  return { check: compareFingerprint(recomputed.hash, onFile === undefined ? undefined : onFile?.hash ?? null), recomputed, onFile };
}
