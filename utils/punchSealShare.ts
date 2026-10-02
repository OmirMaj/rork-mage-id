// utils/punchSealShare.ts — the sealed final punch PDF, made and stored (lane SEAL).
//
// The I/O half. utils/punchSealHtml.ts (pure) prints the stored row; this file
// resolves the photos it cannot (the sealed after-photo copies in punch-seals,
// the before photos in project-photos), then:
//
//  - NATIVE: renders the PDF, hashes its BYTES with expo-crypto, uploads it
//    write-once (upsert:false) to punch-seals/<uid>/<sealId>/record.pdf, has
//    seal-punch re-hash it and attach path + hash ONCE, then opens the share
//    sheet. A record that already has its PDF stored is re-rendered and shared,
//    never uploaded again.
//  - WEB: opens the print window from the same HTML with the line "Printed from
//    the sealed record. The stored PDF copy is made in the phone app." No hash
//    is stored from a browser (utils/contractSealing.ts precedent).
//
// Never writes the seal itself; never queued (a legal record needs a live
// answer, utils/moments/commitResult offlineLegalReason).
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import type { PunchSeal } from '@/types';
import { buildPunchSealHtml, punchSealFileTitle, type PunchSealHtmlOptions } from '@/utils/punchSealHtml';
import { resolvePhotoUrls } from '@/utils/storage';
import { openPrintWindowAfterOrThrow, readAsBase64 } from '@/utils/platformFile';
import { edgeFunctionError } from '@/utils/edgeError';
import { punchSealFromRow } from '@/hooks/usePunchSeal';

export const PUNCH_SEAL_BUCKET = 'punch-seals';
/** Signed-URL life for the photos in one PDF render. */
const PHOTO_URL_TTL_SECONDS = 600;
/** Same ceiling as the daily report PDF (pdfGenerator DFR_PDF_EMBED_BUDGET_CHARS). */
const EMBED_BUDGET_CHARS = 15_000_000;

export function punchSealPdfPath(userId: string, sealId: string): string {
  return `${userId}/${sealId}/record.pdf`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = (globalThis as { atob?: (s: string) => string }).atob?.(b64) ?? '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Image sources for the record, keyed by storage path. */
async function resolvePhotos(seal: PunchSeal): Promise<Pick<PunchSealHtmlOptions, 'photos' | 'omitted'>> {
  const items = Array.isArray(seal.manifest?.items) ? seal.manifest.items : [];
  const afterPaths = items.map((i) => i.afterPhoto?.path).filter((p): p is string => typeof p === 'string' && !!p);
  const beforePaths = items.map((i) => i.beforePhoto).filter((p): p is string => typeof p === 'string' && !!p);

  const remote = new Map<string, string>();
  if (afterPaths.length > 0) {
    for (let i = 0; i < afterPaths.length; i += 100) {
      const chunk = afterPaths.slice(i, i + 100);
      const { data } = await supabase.storage.from(PUNCH_SEAL_BUCKET).createSignedUrls(chunk, PHOTO_URL_TTL_SECONDS);
      for (const row of data ?? []) if (row?.path && row.signedUrl) remote.set(row.path, row.signedUrl);
    }
  }
  if (beforePaths.length > 0) {
    const signed = await resolvePhotoUrls(beforePaths);
    for (const [k, v] of signed) remote.set(k, v);
  }

  const photos: Record<string, string> = {};
  const omitted: string[] = [];
  if (Platform.OS === 'web') {
    for (const [k, v] of remote) photos[k] = v;
    return { photos, omitted };
  }
  // Native: embed, so the PDF never prints a tile that was still loading.
  let used = 0;
  let n = 0;
  for (const [path, url] of remote) {
    n += 1;
    if (!FileSystem.cacheDirectory) break;
    try {
      const dl = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}punch-seal-${n}.img`);
      if (dl.status < 200 || dl.status >= 300) continue;
      const b64 = await readAsBase64(dl.uri);
      if (!b64) continue;
      const src = `data:image/jpeg;base64,${b64}`;
      if (used + src.length > EMBED_BUDGET_CHARS) { omitted.push(path); continue; }
      used += src.length;
      photos[path] = src;
    } catch { /* this tile prints "could not be loaded" */ }
  }
  return { photos, omitted };
}

export type PunchSealPdfResult =
  | { kind: 'web_print' }
  | { kind: 'shared' | 'printed'; stored: boolean; seal: PunchSeal; storeError?: string };

/**
 * Save the record's PDF. Errors from rendering or the web print window throw;
 * a failed STORE on native does not stop the share (the GC still gets his
 * copy) and comes back as `storeError`, so the screen says "PDF copy not
 * stored yet" instead of pretending.
 */
export async function savePunchSealPdf(args: { seal: PunchSeal; userId: string; companyName: string }): Promise<PunchSealPdfResult> {
  const { seal, userId, companyName } = args;
  if (Platform.OS === 'web') {
    await openPrintWindowAfterOrThrow(async () => {
      const resolved = await resolvePhotos(seal);
      return buildPunchSealHtml(seal, { companyName, mode: 'web', ...resolved });
    });
    return { kind: 'web_print' };
  }

  const resolved = await resolvePhotos(seal);
  const html = buildPunchSealHtml(seal, { companyName, mode: 'native', ...resolved });
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  let stored = !!seal.pdfPath;
  let current = seal;
  let storeError: string | undefined;
  if (!seal.pdfPath) {
    try {
      current = await storePdf(seal, userId, uri);
      stored = true;
    } catch (e) {
      storeError = e instanceof Error ? e.message : 'The PDF copy could not be stored.';
    }
  }

  const title = punchSealFileTitle(seal.manifest?.project?.name ?? '');
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
    return { kind: 'shared', stored, seal: current, storeError };
  }
  await Print.printAsync({ uri });
  return { kind: 'printed', stored, seal: current, storeError };
}

async function storePdf(seal: PunchSeal, userId: string, fileUri: string): Promise<PunchSeal> {
  const path = punchSealPdfPath(userId, seal.id);
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  let bytes = base64ToBytes(base64);
  if (bytes.byteLength === 0) throw new Error('The PDF could not be read on this phone.');

  const up = await supabase.storage.from(PUNCH_SEAL_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error) {
    const msg = (up.error.message ?? '').toLowerCase();
    if (!(msg.includes('already exists') || msg.includes('duplicate') || msg.includes('conflict'))) {
      throw new Error('The PDF copy could not be uploaded. Check your connection and try again.');
    }
    // An earlier try uploaded it and never attached it. The stored object is
    // write-once, so attach THAT file: hash what is stored, not this render.
    const dl = await supabase.storage.from(PUNCH_SEAL_BUCKET).download(path);
    if (dl.error || !dl.data) throw new Error('The PDF copy could not be checked. Try again.');
    bytes = new Uint8Array(await dl.data.arrayBuffer());
  }
  const clientHash = await sha256HexOfBytes(bytes);

  const { data, error } = await supabase.functions.invoke('seal-punch', {
    body: { action: 'attach_pdf', seal_id: seal.id, storage_path: path, client_hash: clientHash },
  });
  if (error) {
    const e = await edgeFunctionError(error, 'The PDF copy could not be stored.');
    throw new Error(e.message);
  }
  const row = punchSealFromRow((data as { seal?: unknown } | null)?.seal);
  if (!row || !row.pdfPath || !row.pdfHash) throw new Error('The PDF copy could not be stored.');
  return row;
}
