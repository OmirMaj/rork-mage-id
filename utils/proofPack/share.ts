// utils/proofPack/share.ts — the Pay Period Record, made and handed over.
//
// The I/O half. utils/proofPack/core.ts (pure) decides what the package says,
// utils/proofPack/html.ts (pure) prints it; this file takes the fingerprint,
// puts it on file, resolves the photo images, renders the PDF through the
// app's ordinary path (expo-print) and opens the share sheet (native) or a
// print window (web).
//
// THE ONLY THINGS THAT LEAVE THE DEVICE HERE:
//   - the fingerprint record (utils/proofPack/store fileFingerprint), and
//   - on native, the SHA-256 of the PDF file (attachFileFingerprint).
// The PDF itself goes only where the contractor sends it from the share sheet.
// Nothing is sent to a model. Nothing is sent without the tap that calls
// createAndShareProofPack.
//
// Photo images are read from the project's own storage with short-lived signed
// URLs (the same reader the daily report PDF uses), embedded on native.
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import type { CompanyBranding, DFRPhoto } from '@/types';
import type { ProofPack, ProofPhotoItem } from '@/utils/proofPack/core';
import type { ProofDocLang } from '@/utils/proofPack/docCopy';
import { proofPackFingerprint, type ProofCheck, compareFileFingerprint } from '@/utils/proofPack/fingerprint';
import { PROOF_PACK_MAX_PHOTOS, buildProofPackHtml, proofPackFileTitle } from '@/utils/proofPack/html';
import {
  attachFileFingerprint, fileFingerprint, saveProofPack, sha256HexOnDevice, type SavedProofPack,
} from '@/utils/proofPack/store';
import { resolveDfrPhotosForDocument } from '@/utils/projectDocuments';
import { openPrintWindowAfterOrThrow, readAsBase64 } from '@/utils/platformFile';

/** The device-side fields of a photo the pure package does not carry (where the image is). */
export interface ProofPhotoSource { id: string; uri?: string; localUri?: string; storagePath?: string; timestamp?: string }

function base64ToBytes(b64: string): Uint8Array {
  const bin = (globalThis as { atob?: (s: string) => string }).atob?.(b64) ?? '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** SHA-256 of a file's bytes, lower-case hex. */
export async function sha256HexOfFile(uri: string): Promise<string> {
  const bytes = base64ToBytes(await readAsBase64(uri));
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Image sources for the photos that print as images, keyed by item key. Never throws. */
export async function resolveProofPhotoSources(
  pack: ProofPack,
  sources: readonly ProofPhotoSource[],
): Promise<Record<string, string | null>> {
  const shown = pack.items.filter((i): i is ProofPhotoItem => i.kind === 'photo').slice(0, PROOF_PACK_MAX_PHOTOS);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const asDfr: DFRPhoto[] = shown.map((p) => {
    const s = byId.get(p.id);
    return {
      id: p.id,
      uri: s?.uri ?? '',
      storagePath: s?.storagePath ?? p.storagePath ?? undefined,
      localUri: s?.localUri,
      timestamp: s?.timestamp ?? p.takenAt ?? '',
    };
  });
  const out: Record<string, string | null> = {};
  try {
    const resolved = await resolveDfrPhotosForDocument(asDfr, []);
    for (const r of resolved) out[`photo:${r.id}`] = r.src ?? null;
  } catch {
    for (const p of shown) out[p.key] = null;
  }
  return out;
}

export interface ProofShareArgs {
  pack: ProofPack;
  lang: ProofDocLang;
  branding: CompanyBranding;
  photoSources: readonly ProofPhotoSource[];
}

export interface ProofShareResult {
  how: 'shared' | 'printed' | 'web_print';
  saved: SavedProofPack;
  /** False when the copy could not be kept on this device. */
  keptOnDevice: boolean;
}

async function prepare(args: ProofShareArgs): Promise<{ html: string; saved: SavedProofPack }> {
  const fingerprint = await proofPackFingerprint(args.pack, sha256HexOnDevice);
  const filed = await fileFingerprint(args.pack, fingerprint);
  const photoSrc = await resolveProofPhotoSources(args.pack, args.photoSources);
  const html = buildProofPackHtml(args.pack, {
    branding: args.branding,
    lang: args.lang,
    fingerprint: { hash: fingerprint.hash, code: fingerprint.code, serverCreatedAt: filed?.createdAt ?? null },
    photoSrc,
  });
  return {
    html,
    saved: {
      pack: args.pack, lang: args.lang, fingerprint,
      serverId: filed?.id ?? null, serverCreatedAt: filed?.createdAt ?? null, pdfHash: filed?.pdfHash ?? null,
    },
  };
}

/**
 * Makes the package and opens it for the contractor to keep or send.
 *  - web: opens the print tab INSIDE the tap, then fills it. No file fingerprint
 *    is taken from a browser (utils/punchSealShare.ts precedent).
 *  - native: renders the PDF, fingerprints the file, attaches that once, keeps
 *    the copy on the device, then opens the share sheet.
 * Errors from rendering propagate; the caller shows them.
 */
export async function createAndShareProofPack(args: ProofShareArgs): Promise<ProofShareResult> {
  if (Platform.OS === 'web') {
    let saved: SavedProofPack | null = null;
    await openPrintWindowAfterOrThrow(async () => {
      const p = await prepare(args);
      saved = p.saved;
      return p.html;
    });
    const s = saved as unknown as SavedProofPack;
    return { how: 'web_print', saved: s, keptOnDevice: await saveProofPack(s) };
  }
  const { html, saved } = await prepare(args);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (saved.serverId && !saved.pdfHash) {
    try {
      saved.pdfHash = await attachFileFingerprint(saved.serverId, await sha256HexOfFile(uri));
    } catch {
      saved.pdfHash = null;
    }
  }
  const keptOnDevice = await saveProofPack(saved);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: proofPackFileTitle(args.pack, args.lang),
      UTI: 'com.adobe.pdf',
    });
    return { how: 'shared', saved, keptOnDevice };
  }
  await Print.printAsync({ uri });
  return { how: 'printed', saved, keptOnDevice };
}

/** Is this file the one MAGE ID fingerprinted? Compares the file's bytes with the file fingerprint on record. */
export async function checkFileAgainst(uri: string, pdfHashOnFile: string | null | undefined): Promise<ProofCheck> {
  return compareFileFingerprint(await sha256HexOfFile(uri), pdfHashOnFile);
}
